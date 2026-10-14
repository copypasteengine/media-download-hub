ARG COBALT_IMAGE=ghcr.io/imputnet/cobalt@sha256:63186dd68afd57ce3bb1f62cc4c139f5fa95b9c3e87a3cf5c6e4c7a570523f62
FROM ${COBALT_IMAGE}
USER root
RUN apk add --no-cache chromium xvfb x11vnc novnc websockify python3 py3-websocket-client ca-certificates font-noto-cjk
COPY server.py /opt/browser/server.py
ENV HOME=/tmp/home PYTHONDONTWRITEBYTECODE=1
USER 65534:65534
EXPOSE 6090 6080
ENTRYPOINT ["python3", "-u", "/opt/browser/server.py"]
