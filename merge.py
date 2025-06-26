import cv2
import numpy as np


def main():
    image_1 = cv2.imread("images/singlehdr_lc_001_2.jpg")
    image_2 = cv2.imread("images/ours_lc_001_2.jpg")

    # ensure they are the same size
    if image_1.shape != image_2.shape:
        print("Images are not the same size")
        exit()

    # put a red separator between the two images
    separator = np.ones((image_1.shape[0], 30, 3), dtype=np.uint8) * 255
    # separator[:, :, 0] = 255

    merged_image = np.concatenate(
        [
            image_2[:, : image_1.shape[1] // 2],
            separator,
            image_1[:, image_2.shape[1] // 2 :],
        ],
        axis=1,
    )

    cv2.imwrite("images/merged_image.jpg", merged_image)


if __name__ == "__main__":
    main()
