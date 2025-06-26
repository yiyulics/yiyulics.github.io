import cv2

if __name__ == "__main__":
    image = cv2.imread("images/sehdr.jpg")
    cv2.imwrite("images/cropped_sehdr.jpg", image[300:-250, :])
