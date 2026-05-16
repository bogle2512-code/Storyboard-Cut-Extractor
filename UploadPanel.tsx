import argparse
import shutil
from pathlib import Path


def copy_fallback(input_dir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for image_path in input_dir.glob("*"):
        if image_path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
            shutil.copy2(image_path, output_dir / image_path.name)


def run_realesrgan(input_dir: Path, output_dir: Path, scale: int) -> None:
    try:
        from realesrgan import RealESRGANer
        from basicsr.archs.rrdbnet_arch import RRDBNet
        import cv2
    except Exception as exc:
        print(f"Real-ESRGAN import failed, using fallback copy: {exc}")
        copy_fallback(input_dir, output_dir)
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = Path(__file__).parent / "models" / f"RealESRGAN_x{scale}plus.pth"
    if not model_path.exists():
        print(f"Model file not found: {model_path}. Using fallback copy.")
        copy_fallback(input_dir, output_dir)
        return

    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=scale)
    upsampler = RealESRGANer(
        scale=scale,
        model_path=str(model_path),
        model=model,
        tile=0,
        tile_pad=10,
        pre_pad=0,
        half=False,
    )

    for image_path in input_dir.glob("*"):
        if image_path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            continue
        image = cv2.imread(str(image_path), cv2.IMREAD_UNCHANGED)
        if image is None:
            continue
        try:
            output, _ = upsampler.enhance(image, outscale=scale)
            cv2.imwrite(str(output_dir / image_path.name), output)
        except Exception as exc:
            print(f"Failed to upscale {image_path.name}, copying original: {exc}")
            shutil.copy2(image_path, output_dir / image_path.name)


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Real-ESRGAN folder upscaler")
    parser.add_argument("--input", default="input", help="Input image folder")
    parser.add_argument("--output", default="output", help="Output image folder")
    parser.add_argument("--scale", type=int, choices=[2, 4], default=2, help="Upscale factor")
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)
    if not input_dir.exists():
        raise SystemExit(f"Input folder does not exist: {input_dir}")

    run_realesrgan(input_dir, output_dir, args.scale)


if __name__ == "__main__":
    main()
