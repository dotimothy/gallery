import os
import numpy as np
import cv2 as cv
import json
from tqdm import tqdm
import exifread

fullDir = './images/fulls'
thumbDir = './images/thumbs'
metadataDir ='./images/metadata'
for createDir in [fullDir, thumbDir, metadataDir]: 
    if(not(os.path.exists(createDir))): os.mkdir(createDir)
imgNameJS = './imgNames.js'
for file in os.listdir(fullDir): 
    if(file.endswith('.JPG')):
        os.rename(f'{fullDir}/{file}',f'{fullDir}/{file.strip(".JPG")}.jpg')
imgNames = [imgName.split('.jpg')[0] for imgName in os.listdir(fullDir) if imgName.endswith('.jpg')]
imgNames.sort()
newline = '\n'
empty = '' 

def makeImgList(split=2):
    with open(imgNameJS,'w') as file:
        arrayStr = 'const imgNames = ['
        for i,name in tqdm(enumerate(imgNames)): 
            arrayStr += f"\'{name}\'{'' if i == len(imgNames) - 1 else f',{newline if i % split == split-1 else empty}'}"
        arrayStr += '];'
        file.write(arrayStr)

def getThumbs(check=False,size=(400,300)):
    for name in tqdm(imgNames):
        thumbPath = f'./{thumbDir}/{name}.jpg'
        fullPath = f'{fullDir}/{name}.jpg'
        if(not(check) or not(os.path.exists(thumbPath))):
            img = cv.imread(fullPath)
            resized = cv.resize(img,size)
            cv.imwrite(thumbPath,resized,[cv.IMWRITE_JPEG_QUALITY,80])

def getFileSize(filePath):
    return os.stat(filePath).st_size

def getMetadatas(check=False):
    for name in tqdm(imgNames):
        fullPath = f'{fullDir}/{name}.jpg'
        metadataPath = f'{metadataDir}/{name}.json'
        if(not(check) or not(os.path.exists(metadataPath))): # EXIF Metadata
            with open(fullPath,'rb') as full:
                tags = exifread.process_file(full)
                metadata = {} 
            for tag in tags.keys():
                if tag not in ('JPEGThumbnail', 'TIFFThumbnail'):
                    metadata[tag] = str(tags[tag])
            # Custom Metadata
            metadata['File Size'] = getFileSize(fullPath)
            with open(metadataPath, 'w') as metadataFile:
                json.dump(metadata,metadataFile,indent=4)

def createSampleImages(N=25,size=(4000,3000)):
    for i in tqdm(range(N)):
        sample = cv.putText(np.zeros(size,np.uint8),str(i),(size[1]//2,size[0]//2),cv.FONT_HERSHEY_SIMPLEX,10,255,20,cv.LINE_AA)
        sample = cv.copyMakeBorder(sample,100,100,100,100,cv.BORDER_CONSTANT,None,value=255)
        sample = cv.copyMakeBorder(sample,75,75,75,75,cv.BORDER_CONSTANT,None,value=0)
        cv.imwrite(f'{fullDir}/{i}.jpg',sample)

if __name__ == '__main__':
    print('Creating Sample Images')
    createSampleImages()
    imgNames = [str(i) for i,imgName in enumerate(os.listdir(fullDir)) if imgName.endswith('.jpg')]
    print('Making Image List!')
    makeImgList()
    print('Making Thumbnails!')
    getThumbs(check=False)
    print('Extracting Metadata!')
    getMetadatas(check=False)