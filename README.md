# gallery 🖼️

A Web App to display your images along with essential metadata just by putting it in the Gallery Folder!

## Installation

1. Install Python requirements for preparing the gallery with `pip install -r requirements.txt`

2. Place your original images inside of the gallery under `fulls`.

3. Execute `python prepareSite.py` to generate thumbnails under `thumbs` folder and extract important metadata under `metadata` to display in the gallery!

4. Host your gallery site, a quick way is through `python -m http.server` to see your images at <http://127.0.0.1:8000>!

5. Enjoy your images! You should see a site like what is shown below.

![](./example.gif)

---

## Operations

Here's how to operate the gallery:

1.  **Navigating the Gallery:**
    * Click on a thumbnail to open the image viewer.
    * Click the "🏠" button (bottom right) to return to the main gallery. (Hidden in iframes).

2.  **Using the Image Viewer:**
    * **Zoom & Pan:** Use mouse scroll/two-finger pinch to zoom. Drag with mouse/one-finger to pan when zoomed. Double-click to reset zoom/pan.
    * **Fullscreen Mode:** Click "⛶" (top left) to toggle fullscreen for the viewer.
    * **Navigation:** Click "❮" / "❯" arrows (desktop) or swipe left/right (mobile, when not zoomed) to change images. Use the bottom thumbnail selector to jump to specific images.
    * **Viewing Metadata:** Click "ℹ️" (top left) to show/hide image details.

3.  **Keyboard Shortcuts (when viewer is open):**
    * `←` / `→`: Navigate previous/next image.
    * `Esc`: Reset zoom/pan, or exit viewer if at default zoom.
    * `I`: Toggle metadata.
    * `F`: Toggle fullscreen.

---

## Example Portfolios using gallery

1. [TheDoShoots](https://timothydo.me/photography) by Timothy Do