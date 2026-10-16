# Runtime image with the locally built ClashForShell/Zashboard web UI.
FROM ghcr.io/tsutomu-miku/mihomo-docker:latest

COPY dashboard/dist/ /opt/mihomo/ui/
