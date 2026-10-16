# Runtime image with the locally built ClashForShell/Zashboard web UI.
FROM ghcr.io/tsutomu-miku/mihomo-docker:latest

COPY dashboard/dist/ /opt/mihomo/ui/
COPY docker-entrypoint.sh /clashforshell-entrypoint.sh
RUN chmod +x /clashforshell-entrypoint.sh

ENTRYPOINT ["/clashforshell-entrypoint.sh"]
