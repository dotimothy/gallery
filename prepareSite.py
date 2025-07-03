import os
import numpy as np
import cv2 as cv
import json
from tqdm import tqdm
import exifread
import shutil # Import shutil for directory removal

fullDir = './fulls'
thumbDir = './thumbs'
metadataDir ='./metadata' # This directory will now store only metadata.json

# Remove metadata and thumbs directory if it exists before recreating it
if os.path.exists(metadataDir):
    shutil.rmtree(metadataDir)
if os.path.exists(thumbDir):
    shutil.rmtree(thumbDir)

for createDir in [fullDir, thumbDir, metadataDir]: 
    if(not(os.path.exists(createDir))): os.mkdir(createDir)

metadataJSON = './metadata/metadata.json' # Path for the single metadata JSON file

image_files_with_mtime = []
for file in os.listdir(fullDir): 
    if(file.endswith('.JPG')): # Handle .JPG extension if present
        os.rename(f'{fullDir}/{file}',f'{fullDir}/{file.strip(".JPG")}.jpg')
    if(file.endswith('.jpg') or file.endswith('.JPG')): # Ensure we only process .jpg files
        full_path = os.path.join(fullDir, file)
        mtime = os.path.getmtime(full_path)
        image_files_with_mtime.append((file.split('.jpg')[0], mtime))

# Sort by modification time (mtime)
image_files_with_mtime.sort(key=lambda x: x[1])
imgNames = [name for name, mtime in image_files_with_mtime] # Extract only the names in sorted order

newline = '\n'
empty = '' 

def getThumbs(check=False,size=(400,300)):
    """Generates thumbnails for all images."""
    for name in tqdm(imgNames):
        thumbPath = f'./{thumbDir}/{name}.jpg'
        fullPath = f'{fullDir}/{name}.jpg'
        if(not(check) or not(os.path.exists(thumbPath))):
            img = cv.imread(fullPath)
            if img is not None:
                resized = cv.resize(img,size)
                cv.imwrite(thumbPath,resized,[cv.IMWRITE_JPEG_QUALITY,80])
            else:
                print(f"Warning: Could not read image {fullPath}. Skipping thumbnail generation.")

def getFileSize(filePath):
    """Returns the size of a file in bytes."""
    return os.stat(filePath).st_size

def getMetadatas(check=False):
    """
    Extracts EXIF and custom metadata for all images and stores it in a single JSON file.
    This also includes the sorted list of image names.
    """
    all_metadata = {}
    if check and os.path.exists(metadataJSON):
        try:
            with open(metadataJSON, 'r') as f:
                all_metadata = json.load(f)
        except json.JSONDecodeError:
            print(f"Warning: Could not decode existing {metadataJSON}. Starting fresh.")
            all_metadata = {}

    for name in tqdm(imgNames):
        fullPath = f'{fullDir}/{name}.jpg'
        
        # Only process if not checking or if metadata for this image is missing
        if not check or name not in all_metadata or "Error" in all_metadata.get(name, {}): # Re-process if there was an error
            try:
                with open(fullPath,'rb') as full:
                    tags = exifread.process_file(full)
                    metadata = {} 
                for tag in tags.keys():
                    if tag not in ('JPEGThumbnail', 'TIFFThumbnail'):
                        metadata[tag] = str(tags[tag])
                # Custom Metadata
                metadata['File Size'] = getFileSize(fullPath)
                all_metadata[name] = metadata
            except Exception as e:
                print(f"Warning: Could not process metadata for {name}.jpg: {e}")
                all_metadata[name] = {"Error": str(e)} # Store error for debugging
    
    # Store the sorted image names list within the metadata JSON
    all_metadata['image_order'] = imgNames

    with open(metadataJSON, 'w') as metadataFile:
        json.dump(all_metadata, metadataFile, indent=4)

def createSampleImages(N=25,size=(4000,3000)):
    """Creates N sample images for testing."""
    for i in tqdm(range(N)):
        sample = cv.putText(np.zeros(size,np.uint8),str(i),(size[1]//2,size[0]//2),cv.FONT_HERSHEY_SIMPLEX,10,255,20,cv.LINE_AA)
        sample = cv.copyMakeBorder(sample,100,100,100,100,cv.BORDER_CONSTANT,None,value=255)
        sample = cv.copyMakeBorder(sample,75,75,75,75,cv.BORDER_CONSTANT,None,value=0)
        cv.imwrite(f'{fullDir}/{i}.jpg',sample)

if __name__ == '__main__':
    if(len(os.listdir(fullDir)) == 0):
        print('Creating Sample Images')
        createSampleImages()
    # Re-populate imgNames based on modification time after sample image creation
    image_files_with_mtime = []
    for file in os.listdir(fullDir):
        if(file.endswith('.JPG')):
            os.rename(f'{fullDir}/{file}',f'{fullDir}/{file.strip(".JPG")}.jpg')
        if(file.endswith('.jpg') or file.endswith('.JPG')):
            full_path = os.path.join(fullDir, file)
            mtime = os.path.getmtime(full_path)
            image_files_with_mtime.append((file.split('.jpg')[0], mtime))
    image_files_with_mtime.sort(key=lambda x: x[1])
    imgNames = [name for name, mtime in image_files_with_mtime]

    print('Making Thumbnails!')
    getThumbs(check=False)
    print('Extracting Metadata and saving to single JSON!')
    getMetadatas(check=False)
