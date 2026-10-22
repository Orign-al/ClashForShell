# Runtime image with the locally built ClashForShell/Zashboard web UI.
FROM ghcr.io/tsutomu-miku/mihomo-docker:latest

COPY dashboard/dist/ /opt/mihomo/ui/
COPY docker-entrypoint.sh /clashforshell-entrypoint.sh
COPY scripts/configure-substore.mjs /opt/clashforshell/configure-substore.mjs
COPY scripts/sync-substore.mjs /opt/clashforshell/sync-substore.mjs
RUN chmod +x /clashforshell-entrypoint.sh

ENTRYPOINT ["/clashforshell-entrypoint.sh"]
