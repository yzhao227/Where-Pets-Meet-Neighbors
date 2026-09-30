`video-one-second.mp4` is a generated 64 × 48 blue test frame with silent audio.
It contains no third-party imagery, user data or music. It was created locally with:

```sh
ffmpeg -f lavfi -i color=c=blue:s=64x48:r=10:d=1 -f lavfi -i anullsrc=r=8000:cl=mono -t 1 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart video-one-second.mp4
```

Tests read this checked-in fixture; FFmpeg is not a test or runtime dependency.
