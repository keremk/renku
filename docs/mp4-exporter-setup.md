# Docker Setup for MP4 Exporter
In order for the MP4 Exporter to generate mp4 file, it needs to run Remotion Server which uses headless-chrome. Doing this reliably in a host system (Mac, Windows/WSL, Linux) etc. requires quite a bit of setup, so instead we built a docker image that you can build locally on your machine (only need docker installed). Once you build the container image, the MP4 producer will find and run it. Make sure Docker deamon (Docker Desktop usually) is running on your host machine.

Build the provided lean Docker image using this:
```bash
docker build -f Dockerfile.remotion -t renku-remotion-export .
```
