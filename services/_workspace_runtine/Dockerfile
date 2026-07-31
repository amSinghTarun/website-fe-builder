FROM node:lts-alpine

WORKDIR /app

EXPOSE 5173

COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]


# how to run this docker file after build
# docker run -p 5173:5173 -e TEMPLATE=vue my-vite-image