FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN go mod tidy && CGO_ENABLED=0 go build -o /out/backend .

FROM alpine:3.19
RUN adduser -D app && mkdir -p /app/uploads && chown app /app/uploads
COPY --from=build /out/backend /usr/local/bin/backend
USER app
WORKDIR /app
EXPOSE 8080
CMD ["backend"]
