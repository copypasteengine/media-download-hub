# Manager, queue and bots use a standalone Node runtime, not the Cobalt application.
ARG COBALT_IMAGE=ghcr.io/imputnet/cobalt@sha256:63186dd68afd57ce3bb1f62cc4c139f5fa95b9c3e87a3cf5c6e4c7a570523f62
ARG NODE_IMAGE=node@sha256:8510330d3eb72c804231a834b1a8ebb55cb3796c3e4431297a24d246b8add4d5
FROM ${COBALT_IMAGE} AS ffmpeg-binary
FROM ${NODE_IMAGE}
ARG TARGETARCH
USER root
COPY runtime/app/package*.json /runtime/
COPY runtime/feishu/package*.json /feishu-runtime/
COPY runtime/youtube/package*.json /youtube-runtime/
RUN cd /runtime && npm ci --omit=dev --ignore-scripts && cd /feishu-runtime && npm ci --omit=dev --ignore-scripts && cd /youtube-runtime && npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=ffmpeg-binary /app/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg /usr/local/bin/ffmpeg
COPY vendor/xray/ /opt/xray/
RUN arch="${TARGETARCH:-$(node -p 'process.arch === "arm64" ? "arm64" : "amd64"')}" && cp "/opt/xray/$arch/xray" /usr/local/bin/xray && chmod 755 /usr/local/bin/xray /usr/local/bin/ffmpeg && rm -rf /opt/xray
COPY app /project/app
COPY manager /project/manager
COPY vendor/web /project/vendor/web
WORKDIR /project
ENTRYPOINT ["node"]
CMD ["/project/manager/server.mjs"]
