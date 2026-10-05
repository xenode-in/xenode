FROM nginx:1.30-alpine

# The image's entrypoint renders templates into conf.d with the environment.
COPY deploy/file-runtimes/preview/default.conf.template /etc/nginx/templates/default.conf.template
COPY tools/file-runtimes/preview/ /usr/share/nginx/html/

EXPOSE 8080
