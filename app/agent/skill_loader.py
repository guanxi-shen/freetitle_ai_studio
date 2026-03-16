"""Skill loader -- dynamic skill-based agent architecture.

Skills are modular YAML+markdown definitions that the agent loads on demand via FC
tool calls. Each skill contains domain-specific procedures, provider rules, and
prompt patterns for a production stage (script, storyboard, video, audio, editing).
This architecture lets the agent orchestrate the full interleaved multimodal
pipeline -- loading the right expertise for each content type it generates.

Resolution:
  1. skills/{name}/SKILL.md exists -> bundle load (body + include: refs)
  2. skills/{name}.md exists -> single file load
  3. Not found -> None

include: path resolution:
  - _shared/ prefix -> from skills root (skills/_shared/{ref}.md)
  - no prefix -> relative to SKILL.md folder (skills/{name}/{ref}.md)
"""

import os
import logging

import yaml

logger = logging.getLogger(__name__)
SKILLS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'skills')

_catalog = {}  # {name: description} -- top-level skills only
_cache = {}    # {relative_path: {body, includes, dir_path}} -- all SKILL.md entries
_files = {}    # {relative_path: content} -- all .md files


def _parse_frontmatter(content: str):
    """Extract name, description, include list from YAML frontmatter."""
    if not content.startswith('---'):
        return None, None, None
    parts = content.split('---', 2)
    if len(parts) < 3:
        return None, None, None
    try:
        meta = yaml.safe_load(parts[1])
    except yaml.YAMLError:
        return None, None, None
    if not isinstance(meta, dict):
        return None, None, None
    return meta.get('name'), meta.get('description'), meta.get('include')


def _strip_frontmatter(content: str) -> str:
    """Return markdown body after frontmatter."""
    if not content.startswith('---'):
        return content
    parts = content.split('---', 2)
    if len(parts) < 3:
        return content
    return parts[2].strip()


def _scan():
    """Recursive scan: find all SKILL.md files, parse frontmatter, cache all .md files."""
    if not os.path.isdir(SKILLS_DIR):
        logger.info("Skills directory not found: %s", SKILLS_DIR)
        return

    for root, dirs, files in os.walk(SKILLS_DIR):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        rel = os.path.relpath(root, SKILLS_DIR).replace('\\', '/')
        if rel == '.':
            rel = ''

        for f in files:
            if not f.endswith('.md'):
                continue
            fpath = os.path.join(root, f)
            try:
                content = open(fpath, encoding='utf-8').read()
            except Exception as e:
                logger.warning("Failed to read %s: %s", fpath, e)
                continue

            file_rel = f"{rel}/{f}" if rel else f
            _files[file_rel] = content

            if f == 'SKILL.md':
                try:
                    name, desc, includes = _parse_frontmatter(content)
                    skill_key = rel  # e.g. "creative-direction", "templates/nolan"
                    body = _strip_frontmatter(content)
                    _cache[skill_key] = {
                        'body': body,
                        'includes': includes or [],
                        'dir_path': root,
                    }
                    # Top-level skills only (no slash in key, not _shared)
                    if '/' not in skill_key and not skill_key.startswith('_'):
                        _catalog[name or skill_key] = desc or ''
                except Exception as e:
                    logger.warning("Failed to parse SKILL.md at %s: %s", fpath, e)


def get_catalog() -> dict:
    """Return {name: description} for top-level skills."""
    return dict(_catalog)


def load(name: str) -> str | None:
    """Unified resolver. Returns skill bundle or single file content.

    Resolution:
    1. skills/{name}/SKILL.md exists -> bundle: body + auto-resolved include: refs
    2. skills/{name}.md exists -> single file content
    3. Not found -> None
    """
    # Bundle load
    if name in _cache:
        entry = _cache[name]
        parts = [entry['body']]
        for ref in entry['includes']:
            ref_content = _resolve_include(ref, name)
            if ref_content:
                parts.append(f"\n---\n[Included: {ref}]\n{ref_content}")
            else:
                logger.warning("Skill %s: include '%s' not found", name, ref)
        return '\n'.join(parts)

    # File load (e.g. "creative-direction/some-file" or "_shared/cinematic-vocabulary")
    file_key = f"{name}.md"
    if file_key in _files:
        return _files[file_key]

    return None


def _resolve_include(ref: str, skill_name: str) -> str | None:
    """Resolve include: ref to file content."""
    if ref.startswith('_shared/'):
        key = f"{ref}.md"
    else:
        key = f"{skill_name}/{ref}.md"
    return _files.get(key)


_scan()
