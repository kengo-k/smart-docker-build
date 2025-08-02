# image: test-image
# imageTagsOnTagPushed: ["{tag}"]
# imageTagsOnBranchPushed: ["{branch}-{timestamp}-{sha}", "latest"]
# watchFiles: ["*.ts", "*.js", "*.json"]

FROM alpine:latest

RUN echo "Test image built at $(date)" > /build-info.txt

CMD ["echo", "Hello from test image!"]
