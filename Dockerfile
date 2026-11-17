FROM nginx:1.27-alpine

# 靜態網站：nginx 直接服務，冇 Node 後端
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 只複製網站真正需要的檔案，避免把設定／文件放進公開 web root
COPY index.html manifest.webmanifest sw.js offline.html robots.txt /usr/share/nginx/html/
RUN touch /usr/share/nginx/html/.nojekyll
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY icons/ /usr/share/nginx/html/icons/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
