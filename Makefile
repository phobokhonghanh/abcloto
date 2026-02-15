IMAGE_NAME = abcloto
CONTAINER_NAME = loto-app
PORT = 8000

.PHONY: help build run stop restart logs clean shell install dev

help:
	@echo "Available commands:"
	@echo "  make build    - Build Docker image"
	@echo "  make run      - Run Docker container (replaces existing one)"
	@echo "  make stop     - Stop and remove container"
	@echo "  make restart  - Restart container"
	@echo "  make logs     - View container logs"
	@echo "  make clean    - Remove container and image"
	@echo "  make shell    - Open bash shell inside container"
	@echo "  make dev      - Run locally with autoreload (requires venv)"

build:
	sudo docker build -t $(IMAGE_NAME) .

run:
	@echo "Stopping existing container if any..."
	-sudo docker rm -f $(CONTAINER_NAME)
	@echo "Starting new container..."
	sudo docker run -d \
		-p $(PORT):8000 \
		--name $(CONTAINER_NAME) \
		--restart always \
		-v $$(pwd)/data:/app/data \
		$(IMAGE_NAME)
	@echo "Container started. Access at http://localhost:$(PORT)"

stop:
	sudo docker stop $(CONTAINER_NAME)
	sudo docker rm $(CONTAINER_NAME)

restart: stop run

logs:
	sudo docker logs -f $(CONTAINER_NAME)

clean:
	-sudo docker rm -f $(CONTAINER_NAME)
	-sudo docker rmi $(IMAGE_NAME)

shell:
	sudo docker exec -it $(CONTAINER_NAME) /bin/bash

# Local development
install:
	pip install -r requirements.txt

dev:
	./start.sh
