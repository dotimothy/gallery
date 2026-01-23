import os
import numpy as np
import cv2 as cv
import json
from tqdm import tqdm
import exifread
import shutil
from datetime import datetime
from PIL import Image
from PIL.ExifTags import TAGS
import time
from multiprocessing import Pool, cpu_count
import argparse

fullDir = './fulls'
thumbDir = './thumbs'
metadataDir = './metadata'
metadataJSON = './metadata/metadata.json'

imgNames = []

def _convert_to_degrees(value):
    d = float(value.values[0].numerator) / value.values[0].denominator
    m = float(value.values[1].numerator) / value.values[1].denominator
    s = float(value.values[2].numerator) / value.values[2].denominator
    return d + (m / 60.0) + (s / 3600.0)

def get_gps_coordinates(tags):
    lat = tags.get('GPS GPSLatitude')
    lat_ref = tags.get('GPS GPSLatitudeRef')
    lon = tags.get('GPS GPSLongitude')
    lon_ref = tags.get('GPS GPSLongitudeRef')

    if lat and lat_ref and lon and lon_ref:
        latitude = _convert_to_degrees(lat)
        if str(lat_ref) == 'S':
            latitude *= -1

        longitude = _convert_to_degrees(lon)
        if str(lon_ref) == 'W':
            longitude *= -1
        return latitude, longitude
    return None

def process_thumbnail(args):
    name, quality, size = args
    thumbPath = f'./{thumbDir}/{name}.jpg'
    fullPath = f'{fullDir}/{name}.jpg'
    
    if os.path.exists(thumbPath):
        return # Skip if exists (or we could add a force flag)

    img = cv.imread(fullPath)
    if img is not None:
        resized = cv.resize(img, size)
        q = int(max(1, min(quality, 100)))
        cv.imwrite(thumbPath, resized, [cv.IMWRITE_JPEG_QUALITY, q, cv.IMWRITE_JPEG_PROGRESSIVE, 1])
    else:
        print(f"Warning: Could not read image {fullPath}. Skipping thumbnail generation.")

def getThumbs(quality=85, check=False, size=(1200, 900)):
    # Prepare arguments for multiprocessing
    tasks = []
    for name in imgNames:
        thumbPath = f'./{thumbDir}/{name}.jpg'
        if not check or not os.path.exists(thumbPath):
            tasks.append((name, quality, size))
    
    if not tasks:
        return

    # Use multiprocessing
    with Pool(cpu_count()) as pool:
        list(tqdm(pool.imap_unordered(process_thumbnail, tasks), total=len(tasks), desc="Making Thumbnails"))

def getFileSize(filePath):
    return os.stat(filePath).st_size

def process_metadata(name):
    fullPath = f'{fullDir}/{name}.jpg'
    metadata = {}
    
    try:
        with open(fullPath, 'rb') as full_file:
            tags = exifread.process_file(full_file)
        
        for tag in tags.keys():
            if tag not in ('JPEGThumbnail', 'TIFFThumbnail'):
                metadata[tag] = str(tags[tag])

        # Get width and height from PIL.Image
        try:
            with Image.open(fullPath) as img_pil:
                metadata['Image Width'] = img_pil.width
                metadata['Image Height'] = img_pil.height
        except Exception as e:
            # print(f"Warning: Could not get dimensions for {name}.jpg: {e}")
            metadata['Image Width'] = metadata.get('Image Width', 'N/A')
            metadata['Image Height'] = metadata.get('Image Height', 'N/A')

        # GPS
        if tags.get('GPS GPSLatitude') and tags.get('GPS GPSLongitude'):
            metadata['GPS GPSLatitude'] = str(tags['GPS GPSLatitude'])
            metadata['GPS GPSLatitudeRef'] = str(tags['GPS GPSLatitudeRef'])
            metadata['GPS GPSLongitude'] = str(tags['GPS GPSLongitude'])
            metadata['GPS GPSLongitudeRef'] = str(tags['GPS GPSLongitudeRef'])

        metadata['File Size'] = getFileSize(fullPath)
        return (name, metadata)

    except Exception as e:
        return (name, {"Error": str(e)})

def getMetadatas(check=False):
    all_metadata = {}
    if check and os.path.exists(metadataJSON):
        try:
            with open(metadataJSON, 'r') as f:
                all_metadata = json.load(f)
        except json.JSONDecodeError:
            print(f"Warning: Could not decode existing {metadataJSON}. Starting fresh.")
            all_metadata = {}

    tasks = []
    for name in imgNames:
        # If check is True, only process missing ones
        if not check or name not in all_metadata or "Error" in all_metadata.get(name, {}):
            tasks.append(name)

    if tasks:
        with Pool(cpu_count()) as pool:
            results = list(tqdm(pool.imap_unordered(process_metadata, tasks), total=len(tasks), desc="Extracting Metadata"))
        
        for name, meta in results:
            all_metadata[name] = meta
    
    all_metadata['image_order'] = imgNames

    with open(metadataJSON, 'w') as metadataFile:
        json.dump(all_metadata, metadataFile, indent=4)

def createSampleImages(N=25, size=(4000, 3000), quality=85):
    q = int(max(1, min(quality, 100)))
    if not os.path.exists(fullDir): os.mkdir(fullDir)
    
    for i in tqdm(range(N), desc="Creating Sample Images"):
        sample = np.zeros(size[::-1], np.uint8)
        cv.putText(sample, str(i), (size[0]//2, size[1]//2), cv.FONT_HERSHEY_SIMPLEX, 10, 255, 20, cv.LINE_AA)
        sample = cv.copyMakeBorder(sample, 100, 100, 100, 100, cv.BORDER_CONSTANT, None, value=255)
        sample = cv.copyMakeBorder(sample, 75, 75, 75, 75, cv.BORDER_CONSTANT, None, value=0)
        cv.imwrite(f'{fullDir}/{i}.jpg', sample, [cv.IMWRITE_JPEG_QUALITY, q, cv.IMWRITE_JPEG_PROGRESSIVE, 1])

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Prepare site images and metadata.')
    parser.add_argument('-n', '--number', type=int, default=25, help='Number of sample images.')
    parser.add_argument('-q', '--quality', type=int, default=85, help='Quality (1-100).')
    args = parser.parse_args()

    # Setup Stats
    stats = {}
    start_time = time.time()

    # Ensure directories exist
    for d in [fullDir, thumbDir, metadataDir]:
        if not os.path.exists(d): os.mkdir(d)

    # Check for empty fulls
    if len(os.listdir(fullDir)) == 0:
        print(f'No images found. Creating {args.number} sample images...')
        createSampleImages(N=args.number, quality=args.quality)

    print('Processing existing images...')

    # 1. CLEANUP & SORTING
    # This part is fast enough to stay single-threaded usually
    processable_files = []
    for file in os.listdir(fullDir):
        name, ext = os.path.splitext(file)
        ext = ext.lower()
        if ext in ['.jpeg', '.jpg']:
             # normalize ext
            if file.endswith('.JPG'):
                new_file = name + '.jpg'
                if file != new_file: 
                    os.rename(os.path.join(fullDir, file), os.path.join(fullDir, new_file))
                file = new_file
            processable_files.append(file)
            
    # Sort by Date Taken
    image_files_for_sorting = []
    for file in processable_files:
        name_without_ext = os.path.splitext(file)[0]
        full_path = os.path.join(fullDir, file)
        exif_date_time = None
        try:
            with open(full_path, 'rb') as f:
                tags = exifread.process_file(f, stop_tag='DateTimeOriginal')
                if 'EXIF DateTimeOriginal' in tags:
                    try:
                        exif_date_time = datetime.strptime(str(tags['EXIF DateTimeOriginal']), "%Y:%m:%d %H:%M:%S")
                    except ValueError: pass
        except: pass
        
        sort_key = exif_date_time.timestamp() if exif_date_time else os.path.getmtime(full_path)
        image_files_for_sorting.append((name_without_ext, sort_key))

    image_files_for_sorting.sort(key=lambda x: x[1])
    imgNames = [name for name, _ in image_files_for_sorting]
    
    # 2. THUMBNAILS
    t0 = time.time()
    print('Generating thumbnails...')
    getThumbs(quality=args.quality, check=False)
    stats['thumbs_time'] = time.time() - t0

    # 3. METADATA
    t1 = time.time()
    print('Extracting metadata...')
    getMetadatas(check=False)
    stats['metadata_time'] = time.time() - t1

    stats['total_time'] = time.time() - start_time

    print('\n=== Processing Complete ===')
    print(f"Total Time:    {stats['total_time']:.2f}s")
    print(f"Thumbs Time:   {stats['thumbs_time']:.2f}s")
    print(f"Metadata Time: {stats['metadata_time']:.2f}s")

