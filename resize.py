import argparse
import os

import cv2


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input_path", type=str, default="images/merged_image.jpg")
    parser.add_argument("--output_dir", type=str, default=None)
    parser.add_argument("--size_w", type=int, default=500)
    parser.add_argument("--size_h", type=int, default=350)
    return parser.parse_args()


if __name__ == "__main__":
    cfgs = parse_args()
    input_path = cfgs.input_path
    output_dir = cfgs.output_dir
    size_w = cfgs.size_w
    size_h = cfgs.size_h

    if output_dir is None:
        output_dir = os.path.dirname(input_path)
    else:
        os.makedirs(output_dir, exist_ok=True)

    img_name = os.path.basename(input_path)
    img_name = os.path.splitext(img_name)[0]
    img_name = f"{img_name}_{size_w}x{size_h}.jpg"

    img = cv2.imread(input_path)
    img = cv2.resize(img, (size_w, size_h), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(output_dir, img_name), img)

    print(f"Resized image saved to {output_dir}")
