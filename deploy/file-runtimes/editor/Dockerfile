FROM nginx:1.27-alpine

COPY deploy/file-runtimes/editor/nginx.conf /etc/nginx/conf.d/default.conf
COPY tools/file-runtimes/editor/ /usr/share/nginx/html/

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
