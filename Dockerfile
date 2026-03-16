# FreeTitle AI Studio -- Google Cloud Run container
# Interleaved multimodal creative pipeline: text + images + video + audio
# All generation via Google GenAI SDK (Vertex AI), deployed on Google Cloud

# Stage 1: Build React UI
FROM node:20-slim AS ui-build
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# Stage 2: Python backend + nginx static serving
FROM python:3.11-slim
# nginx for static serving, ffmpeg for video editing post-production pipeline
RUN apt-get update && apt-get install -y --no-install-recommends nginx ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
COPY prompts/ ./prompts/
COPY skills/ ./skills/
COPY --from=ui-build /app/ui/dist ./ui/dist
COPY nginx.conf /etc/nginx/nginx.conf
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
COPY version.txt* ./
EXPOSE 8080
CMD ["./entrypoint.sh"]
