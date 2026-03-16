"""Agent behavior tracing -- full request lifecycle capture for debugging.

Controlled by AGENT_TRACE flag in config.py. When off, zero overhead.
When on, collects a sequential trace of everything the agent sees, thinks,
does, and returns. Saved as JSON to GCS per request.

Architecture:
  - TraceCollector: per-request event list with thread-safe append
  - TraceLogHandler: captures log records from agent loggers into the trace

Integration pattern (minimal invasion):
  Each existing file gets one-liner additions:
    if tracer: tracer.add("event_type", {"key": "value"})

  The tracer param is threaded through:
    router.py -> runtime.py -> llm.py (and tools.py via closure)

FUTURE SUB-AGENT INTEGRATION:
  When adding new agents (e.g. sub-agents, specialist agents, multi-agent
  orchestration), follow this pattern to integrate with tracing:

  1. Accept `tracer=None` as a parameter in the agent's entry function.
  2. Pass tracer down to any LLM calls: `llm.generate(..., tracer=tracer)`
  3. Add trace events at key decision points:
       if tracer: tracer.add("subagent_start", {"agent": "name", "task": "..."})
       if tracer: tracer.add("subagent_complete", {"agent": "name", "result": "..."})
  4. For agents that spawn child agents, pass the SAME tracer instance so all
     events appear in one unified trace timeline.
  5. If a sub-agent runs in a separate thread, tracer.add() is thread-safe.
  6. For agents running in separate processes or async contexts, create a child
     TraceCollector and merge events into the parent trace on completion.
  7. Tool functions created for sub-agents should follow the same pattern as
     make_tools() -- accept tracer in the closure and trace each tool result.
"""

import time
import threading
import logging
import traceback
from datetime import datetime, timezone
from uuid import uuid4


def _iso_now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


def _ms_since(t0):
    return int((time.time() - t0) * 1000)


# Vertex AI pricing per 1M tokens (March 2026)
# Source: https://cloud.google.com/vertex-ai/generative-ai/pricing
MODEL_PRICING = {
    "gemini-3.1-pro-preview": {
        "input": {"short": 2.00, "long": 4.00},       # <=200K / >200K
        "output": {"short": 12.00, "long": 18.00},     # thinking billed at output rate
        "cached": {"short": 0.20, "long": 0.40},
        "context_threshold": 200_000,
    },
    "gemini-2.5-pro": {
        "input": {"short": 1.25, "long": 2.50},
        "output": {"short": 10.00, "long": 15.00},
        "cached": {"short": 0.125, "long": 0.250},
        "context_threshold": 200_000,
    },
    "gemini-2.5-flash": {
        "input": {"short": 0.30, "long": 0.30},
        "output": {"short": 2.50, "long": 2.50},
        "cached": {"short": 0.030, "long": 0.030},
        "context_threshold": 200_000,
    },
}


def _estimate_cost(model, usage_rounds):
    """Estimate USD cost from token usage. Returns dict with breakdown."""
    pricing = MODEL_PRICING.get(model)
    if not pricing or not usage_rounds:
        return None

    threshold = pricing["context_threshold"]
    total_cost = 0.0
    round_costs = []

    for r in usage_rounds:
        inp = r.get("input", 0)
        out = r.get("output", 0)
        think = r.get("thinking", 0)
        cached = r.get("cached", 0)

        # Determine rate tier based on input token count
        tier = "long" if inp > threshold else "short"

        input_cost = (inp - cached) * pricing["input"][tier] / 1_000_000
        cached_cost = cached * pricing["cached"][tier] / 1_000_000
        # Thinking tokens billed at output rate
        output_cost = (out + think) * pricing["output"][tier] / 1_000_000

        round_total = input_cost + cached_cost + output_cost
        total_cost += round_total
        round_costs.append({
            "round": r["round"],
            "input_cost": round(input_cost, 6),
            "cached_cost": round(cached_cost, 6),
            "output_cost": round(output_cost, 6),
            "total": round(round_total, 6),
            "tier": tier,
        })

    return {
        "total_usd": round(total_cost, 6),
        "model": model,
        "per_round": round_costs,
    }


def _analyze_session(events):
    """Derive session-level insights from collected trace events.
    Detects FC persistence mode, conversation size, and FC activity summary.
    Works by analyzing data shapes from existing events -- no agent code changes needed."""
    info = {}

    # Analyze contents_assembled event to detect history mode
    for evt in events:
        if evt["type"] == "contents_assembled":
            data = evt["data"]
            conv_msgs = data.get("conversation_msgs", 0)
            conv_chars = data.get("conversation_chars", 0)
            items = data.get("items", [])

            # FC persistence: conversation_contents used (chars > 0 but msgs == 0)
            # Gemini-native dicts have {role, parts} -- get("content","") returns ""
            if conv_chars > 0 and conv_msgs == 0:
                native = [i for i in items if i.get("type") == "dict"]
                info["history_mode"] = "fc_persistence"
                info["history_items"] = len(native)
            elif conv_msgs > 0:
                info["history_mode"] = "dialogue"
                info["history_items"] = conv_msgs
            else:
                info["history_mode"] = "none"
                info["history_items"] = 0

            info["history_chars"] = conv_chars
            info["total_contents"] = data.get("count", 0)
            break

    # FC activity in this turn
    tool_events = [e for e in events if e["type"] == "fc_tool_calls"]
    all_calls = []
    for te in tool_events:
        for call in te["data"].get("calls", []):
            all_calls.append(call.get("name", ""))

    info["fc_rounds"] = sum(1 for e in events if e["type"] == "fc_round_start")
    info["total_tool_calls"] = len(all_calls)
    info["tools_used"] = sorted(set(all_calls)) if all_calls else []

    # Role alternation acks injected during normalization
    for evt in events:
        if evt["type"] == "contents_normalized":
            info["acks_injected"] = evt["data"].get("acks_injected", 0)
            break

    return info


class TraceCollector:
    """Thread-safe trace collector for one agent request.

    Usage:
        tracer = TraceCollector(project_name, thread_id, user_email, model)
        tracer.add("system_instruction", {"chars": 4200})
        ...
        doc = tracer.finalize(status="success")
    """

    def __init__(self, project_name, thread_id="", user_email="", model=""):
        self._events = []
        self._lock = threading.Lock()
        self._seq = 0
        self._t0 = time.time()
        self._sse_counts = {}
        self._sse_timestamps = []
        self._usage_rounds = []
        self._log_records = []
        self._phases = {}
        self.trace_id = f"tr_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid4().hex[:5]}"
        self.project_name = project_name
        self.thread_id = thread_id
        self.user_email = user_email
        self.model = model

    def add(self, event_type, data=None):
        """Append trace event. Thread-safe for parallel tool execution."""
        with self._lock:
            self._events.append({
                "seq": self._seq,
                "ts": _iso_now(),
                "elapsed_ms": _ms_since(self._t0),
                "type": event_type,
                "data": data or {},
            })
            self._seq += 1

    def start_phase(self, name):
        """Mark the start of a named phase. Returns phase start time."""
        t = time.time()
        with self._lock:
            self._phases[name] = t
        return t

    def end_phase(self, name):
        """Mark the end of a named phase. Records duration as a trace event."""
        t_end = time.time()
        with self._lock:
            t_start = self._phases.pop(name, None)
        if t_start is None:
            return
        duration_ms = int((t_end - t_start) * 1000)
        self.add("phase", {"name": name, "duration_ms": duration_ms})
        return duration_ms

    def record_sse(self, event_type):
        """Count SSE events and record timestamps."""
        ts = _ms_since(self._t0)
        with self._lock:
            self._sse_counts[event_type] = self._sse_counts.get(event_type, 0) + 1
            self._sse_timestamps.append({"type": event_type, "elapsed_ms": ts})

    def record_usage(self, round_num, usage_metadata):
        """Extract token counts from Gemini response.usage_metadata."""
        if not usage_metadata:
            return
        entry = {
            "round": round_num,
            "input": getattr(usage_metadata, 'prompt_token_count', 0) or 0,
            "output": getattr(usage_metadata, 'candidates_token_count', 0) or 0,
            "thinking": getattr(usage_metadata, 'thoughts_token_count', 0) or 0,
            "total": getattr(usage_metadata, 'total_token_count', 0) or 0,
            "cached": getattr(usage_metadata, 'cached_content_token_count', 0) or 0,
        }
        with self._lock:
            self._usage_rounds.append(entry)

    def add_log(self, record):
        """Capture a log record (called by TraceLogHandler)."""
        with self._lock:
            self._log_records.append({
                "ts": _iso_now(),
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
            })

    def finalize(self, status="success", error=None):
        """Build the final trace document."""
        duration_ms = _ms_since(self._t0)

        # Aggregate token counts
        total_input = sum(r["input"] for r in self._usage_rounds)
        total_output = sum(r["output"] for r in self._usage_rounds)
        total_thinking = sum(r["thinking"] for r in self._usage_rounds)
        total_cached = sum(r["cached"] for r in self._usage_rounds)
        total_all = sum(r["total"] for r in self._usage_rounds)

        # Cost estimation
        cost = _estimate_cost(self.model, self._usage_rounds)

        # Compute phase timings from phase events
        timings = {}
        for evt in self._events:
            if evt["type"] == "phase":
                timings[evt["data"]["name"]] = evt["data"]["duration_ms"]
        timings["total"] = duration_ms

        # SSE timing summary
        sse_timing = None
        if self._sse_timestamps:
            first_token_ms = None
            for s in self._sse_timestamps:
                if s["type"] in ("token", "thinking"):
                    first_token_ms = s["elapsed_ms"]
                    break
            last_ms = self._sse_timestamps[-1]["elapsed_ms"] if self._sse_timestamps else None
            sse_timing = {
                "first_token_ms": first_token_ms,
                "last_event_ms": last_ms,
                "total_events": len(self._sse_timestamps),
                "events": self._sse_timestamps,
            }

        # Add SSE summary event
        if self._sse_counts:
            self.add("sse_summary", {
                "counts": dict(self._sse_counts),
                "first_token_ms": sse_timing["first_token_ms"] if sse_timing else None,
            })

        # Add completion event
        self.add("request_complete", {
            "status": status,
            "duration_ms": duration_ms,
        })

        # Session analysis: FC persistence mode, history size, FC activity
        session = _analyze_session(list(self._events))

        return {
            "trace_id": self.trace_id,
            "project_name": self.project_name,
            "thread_id": self.thread_id,
            "user_email": self.user_email,
            "model": self.model,
            "started_at": datetime.fromtimestamp(self._t0, tz=timezone.utc).isoformat(timespec='milliseconds'),
            "duration_ms": duration_ms,
            "status": status,
            "error": error,
            "session": session,
            "tokens": {
                "input": total_input,
                "output": total_output,
                "thinking": total_thinking,
                "cached": total_cached,
                "total": total_all,
                "per_round": list(self._usage_rounds),
            },
            "cost": cost,
            "timings": timings,
            "sse_timing": sse_timing,
            "events": list(self._events),
            "logs": list(self._log_records),
        }


class TraceLogHandler(logging.Handler):
    """Per-request log handler that captures agent log output into a trace.

    Attached to the root 'app' logger for the duration of one request,
    then removed in the finally block.
    """

    AGENT_LOGGERS = {
        "app.agent.runtime", "app.agent.tools",
        "app.agent.context", "app.llm",
    }

    def __init__(self, tracer):
        super().__init__()
        self._tracer = tracer

    def emit(self, record):
        if record.name in self.AGENT_LOGGERS or record.name.startswith("app.agent."):
            try:
                self._tracer.add_log(record)
            except Exception:
                pass


def format_error_for_trace(exc):
    """Format an exception with full traceback for trace storage."""
    return "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
