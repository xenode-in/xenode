FROM nginx:1.27-alpine

COPY deploy/file-runtimes/preview/nginx.conf /etc/nginx/conf.d/default.conf
COPY tools/file-runtimes/preview/ /usr/share/nginx/html/

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
