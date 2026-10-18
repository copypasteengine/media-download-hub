# Manager, queue and bots use a standalone Node runtime, not the Cobalt application.
ARG COBALT_IMAGE=ghcr.io/imputnet/cobalt@sha256:63186dd68afd57ce3bb1f62cc4c139f5fa95b9c3e87a3cf5c6e4c7a570523f62
ARG NODE_IMAGE=node@sha256:8510330d3eb72c804231a834b1a8ebb55cb3796c3e4431297a24d246b8add4d5
FROM ${COBALT_IMAGE} AS ffmpeg-binary
FROM ${NODE_IMAGE} AS obfs-builder
RUN apk add --no-cache build-base autoconf automake libtool linux-headers libev-dev
COPY vendor/simple-obfs /src/archives
WORKDIR /src
RUN node -e 'const fs=require("fs"),c=require("crypto"),lock=require("./archives/sources.json"); for(const [name,v] of Object.entries(lock)) if(c.createHash("sha256").update(fs.readFileSync("archives/"+name+".tar.gz")).digest("hex")!==v.sha256) throw Error("Source checksum mismatch")' \
 && mkdir simple-obfs && tar -xzf archives/simple-obfs.tar.gz -C simple-obfs --strip-components=1 \
 && tar -xzf archives/libcork.tar.gz -C simple-obfs/libcork --strip-components=1
WORKDIR /src/simple-obfs
RUN ./autogen.sh && CFLAGS='-O2 -std=gnu17' ./configure --disable-documentation && make -j2 && strip src/obfs-local
FROM ${NODE_IMAGE}
ARG TARGETARCH
USER root
COPY runtime/app/package*.json /runtime/
COPY runtime/feishu/package*.json /feishu-runtime/
COPY runtime/youtube/package*.json /youtube-runtime/
RUN cd /runtime && npm ci --omit=dev --ignore-scripts && cd /feishu-runtime && npm ci --omit=dev --ignore-scripts && cd /youtube-runtime && npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=ffmpeg-binary /app/node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg /usr/local/bin/ffmpeg
COPY --from=obfs-builder /src/simple-obfs/src/obfs-local /usr/local/bin/obfs-local
COPY --from=obfs-builder /usr/lib/libev.so.4* /usr/lib/
COPY --from=obfs-builder /src/simple-obfs/COPYING /usr/local/share/licenses/simple-obfs/COPYING
COPY --from=obfs-builder /src/simple-obfs/libcork/COPYING /usr/local/share/licenses/libcork/COPYING
COPY vendor/xray/ /opt/xray/
RUN arch="${TARGETARCH:-$(node -p 'process.arch === "arm64" ? "arm64" : "amd64"')}" && cp "/opt/xray/$arch/xray" /usr/local/bin/xray && chmod 755 /usr/local/bin/xray /usr/local/bin/ffmpeg && rm -rf /opt/xray
COPY app /project/app
COPY manager /project/manager
COPY vendor/web /project/vendor/web
WORKDIR /project
ENTRYPOINT ["node"]
CMD ["/project/manager/server.mjs"]
