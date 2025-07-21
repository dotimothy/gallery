import os
from flask import Flask, render_template, request, redirect, url_for, send_from_directory, jsonify
import piexif
from PIL import Image
import base64
import io
import argparse

# Initialize the Flask application
app = Flask(__name__)

# --- Helper Functions for EXIF GPS Conversion ---

def decimal_to_dms(decimal_degrees):
    """
    Converts decimal degrees to (degrees, minutes, seconds) tuple for EXIF GPS format.
    piexif expects rational numbers (numerator, denominator) for each component.
    Seconds are multiplied by 10000 to maintain precision, with 10000 as the denominator.
    """
    sign = -1 if decimal_degrees < 0 else 1
    abs_degrees = abs(decimal_degrees)
    
    degrees = int(abs_degrees)
    minutes_float = (abs_degrees - degrees) * 60
    minutes = int(minutes_float)
    seconds_float = (minutes_float - minutes) * 60
    seconds = int(seconds_float * 10000) # Use 10000 for higher precision in seconds

    return ((degrees, 1), (minutes, 1), (seconds, 10000))

def dms_to_decimal(dms_tuple, ref):
    """
    Converts a DMS (Degrees, Minutes, Seconds) tuple from piexif format to decimal degrees.
    dms_tuple: ((deg_num, deg_den), (min_num, min_den), (sec_num, sec_den))
    ref: 'N', 'S', 'E', 'W'
    """
    degrees = dms_tuple[0][0] / dms_tuple[0][1]
    minutes = dms_tuple[1][0] / dms_tuple[1][1]
    seconds = dms_tuple[2][0] / dms_tuple[2][1]
    
    decimal_degrees = degrees + (minutes / 60) + (seconds / 3600)
    
    if ref in ['S', 'W']:
        decimal_degrees *= -1
        
    return decimal_degrees

def get_gps_ref(decimal_degrees, is_latitude):
    """
    Determines the GPS reference ('N'/'S' for latitude, 'E'/'W' for longitude)
    based on the sign of the decimal degrees.
    """
    if is_latitude:
        return 'N' if decimal_degrees >= 0 else 'S'
    else:
        return 'E' if decimal_degrees >= 0 else 'W'

def format_rational(value):
    """Formats a piexif rational tuple (numerator, denominator) into a readable string."""
    if isinstance(value, tuple) and len(value) == 2 and value[1] != 0:
        return str(round(value[0] / value[1], 3)) # Round to 3 decimal places for display
    return str(value)

def get_flash_mode(value):
    """Decodes the Flash EXIF tag value into a readable string."""
    flash_map = {
        0x0: "No Flash", 0x1: "Flash fired", 0x5: "Flash fired, compulsory flash mode",
        0x7: "Flash fired, compulsory flash mode, red-eye reduction",
        0x9: "Flash fired, fill-in mode", 0xD: "Flash fired, fill-in mode, red-eye reduction",
        0xF: "Flash fired, red-eye reduction", 0x10: "No flash function",
        0x14: "Flash compulsory off", 0x18: "Flash compulsory off, red-eye reduction",
        0x20: "No flash, auto mode", 0x30: "Flash not in auto mode",
        0x41: "Flash fired, auto mode", 0x45: "Flash fired, auto mode, red-eye reduction",
        0x47: "Flash fired, auto mode, red-eye reduction"
    }
    return flash_map.get(value, f"Unknown ({value})")

def get_metering_mode(value):
    """Decodes the MeteringMode EXIF tag value into a readable string."""
    metering_map = {
        0: "Unknown", 1: "Average", 2: "CenterWeightedAverage", 3: "Spot",
        4: "MultiSpot", 5: "Pattern", 6: "Partial", 255: "Other"
    }
    return metering_map.get(value, f"Unknown ({value})")

# Define the directory where images are stored. This directory must be created.
UPLOAD_FOLDER = 'fulls'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Optional: Set a maximum content length for uploads (though not directly used for this request, good practice)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB max upload size

# Ensure the 'fulls' directory exists. If not, create it.
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
    print(f"Created directory: {UPLOAD_FOLDER}")

# --- Flask Routes ---

@app.route('/')
def index():
    """
    Renders the main page, listing images from the 'fulls' directory
    and displaying their extracted EXIF data.
    """
    images = []
    try:
        # Iterate through files in the UPLOAD_FOLDER
        for filename in os.listdir(app.config['UPLOAD_FOLDER']):
            # Only process common image file extensions
            if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff')):
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                exif_data = {} # Dictionary to store EXIF data for display

                try:
                    # Open the image using Pillow
                    img = Image.open(filepath)
                    # Check if the image has EXIF data
                    if "exif" in img.info:
                        # Load EXIF data using piexif
                        exif_dict = piexif.load(img.info["exif"])

                        # --- Extract and decode common EXIF tags ---
                        # 0th IFD (Image File Directory)
                        if piexif.ImageIFD.Make in exif_dict["0th"]:
                            exif_data["Make"] = exif_dict["0th"][piexif.ImageIFD.Make].decode('utf-8')
                        if piexif.ImageIFD.Model in exif_dict["0th"]:
                            exif_data["Model"] = exif_dict["0th"][piexif.ImageIFD.Model].decode('utf-8')
                        if piexif.ImageIFD.DateTime in exif_dict["0th"]:
                            exif_data["DateTime"] = exif_dict["0th"][piexif.ImageIFD.DateTime].decode('utf-8')
                        if piexif.ImageIFD.Artist in exif_dict["0th"]:
                            exif_data["Artist"] = exif_dict["0th"][piexif.ImageIFD.Artist].decode('utf-8')
                        if piexif.ImageIFD.Copyright in exif_dict["0th"]:
                            exif_data["Copyright"] = exif_dict["0th"][piexif.ImageIFD.Copyright].decode('utf-8')
                        if piexif.ImageIFD.XResolution in exif_dict["0th"]:
                            exif_data["XResolution"] = format_rational(exif_dict["0th"][piexif.ImageIFD.XResolution])
                        if piexif.ImageIFD.YResolution in exif_dict["0th"]:
                            exif_data["YResolution"] = format_rational(exif_dict["0th"][piexif.ImageIFD.YResolution])

                        # Exif IFD
                        if piexif.ExifIFD.DateTimeOriginal in exif_dict["Exif"]:
                            exif_data["DateTimeOriginal"] = exif_dict["Exif"][piexif.ExifIFD.DateTimeOriginal].decode('utf-8')
                        if piexif.ExifIFD.DateTimeDigitized in exif_dict["Exif"]:
                            exif_data["DateTimeDigitized"] = exif_dict["Exif"][piexif.ExifIFD.DateTimeDigitized].decode('utf-8')
                        if piexif.ExifIFD.ExposureTime in exif_dict["Exif"]:
                            exif_data["ExposureTime"] = format_rational(exif_dict["Exif"][piexif.ExifIFD.ExposureTime]) + " s"
                        if piexif.ExifIFD.FNumber in exif_dict["Exif"]:
                            exif_data["FNumber"] = "f/" + format_rational(exif_dict["Exif"][piexif.ExifIFD.FNumber])
                        if piexif.ExifIFD.ISOSpeedRatings in exif_dict["Exif"]:
                            exif_data["ISOSpeedRatings"] = exif_dict["Exif"][piexif.ExifIFD.ISOSpeedRatings]
                        if piexif.ExifIFD.FocalLength in exif_dict["Exif"]:
                            exif_data["FocalLength"] = format_rational(exif_dict["Exif"][piexif.ExifIFD.FocalLength]) + " mm"
                        if piexif.ExifIFD.Flash in exif_dict["Exif"]:
                            exif_data["Flash"] = get_flash_mode(exif_dict["Exif"][piexif.ExifIFD.Flash])
                        if piexif.ExifIFD.MeteringMode in exif_dict["Exif"]:
                            exif_data["MeteringMode"] = get_metering_mode(exif_dict["Exif"][piexif.ExifIFD.MeteringMode])
                        if piexif.ExifIFD.PixelXDimension in exif_dict["Exif"]:
                            exif_data["PixelXDimension"] = exif_dict["Exif"][piexif.ExifIFD.PixelXDimension]
                        if piexif.ExifIFD.PixelYDimension in exif_dict["Exif"]:
                            exif_data["PixelYDimension"] = exif_dict["Exif"][piexif.ExifIFD.PixelYDimension]
                        
                        # Image Dimensions from Pillow (not EXIF but useful for resolution display)
                        exif_data["ImageWidth"] = img.width
                        exif_data["ImageHeight"] = img.height


                        # GPS IFD
                        if piexif.GPSIFD.GPSLatitude in exif_dict["GPS"] and \
                           piexif.GPSIFD.GPSLongitude in exif_dict["GPS"]:
                            lat_dms = exif_dict["GPS"][piexif.GPSIFD.GPSLatitude]
                            lon_dms = exif_dict["GPS"][piexif.GPSIFD.GPSLongitude]
                            lat_ref = exif_dict["GPS"][piexif.GPSIFD.GPSLatitudeRef].decode('utf-8')
                            lon_ref = exif_dict["GPS"][piexif.GPSIFD.GPSLongitudeRef].decode('utf-8')

                            latitude = dms_to_decimal(lat_dms, lat_ref)
                            longitude = dms_to_decimal(lon_dms, lon_ref)
                            exif_data["GPSLatitude"] = f"{latitude:.6f}" # Format to 6 decimal places
                            exif_data["GPSLongitude"] = f"{longitude:.6f}"

                except Exception as e:
                    print(f"Error reading EXIF for {filename}: {e}")
                    exif_data["Error"] = f"Could not read EXIF: {e}"

                images.append({'filename': filename, 'exif': exif_data})
    except FileNotFoundError:
        return f"The '{app.config['UPLOAD_FOLDER']}' directory was not found. Please create it and place images inside, or specify a valid path using --fulls.", 500
    except Exception as e:
        return f"An unexpected error occurred: {e}", 500

    return render_template('exif.html', images=images)

@app.route('/get_exif_gps/<filename>')
def get_exif_gps(filename):
    """
    New endpoint to retrieve GPS coordinates and other relevant EXIF data for a specific image.
    Returns JSON with latitude, longitude, and other EXIF fields, or null if not found.
    """
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(filepath):
        return jsonify({"error": "File not found"}), 404

    exif_data_for_js = {"latitude": None, "longitude": None}
    try:
        img = Image.open(filepath)
        if "exif" in img.info:
            exif_dict = piexif.load(img.info["exif"])

            # GPS Data
            if piexif.GPSIFD.GPSLatitude in exif_dict["GPS"] and \
               piexif.GPSIFD.GPSLongitude in exif_dict["GPS"]:
                lat_dms = exif_dict["GPS"][piexif.GPSIFD.GPSLatitude]
                lon_dms = exif_dict["GPS"][piexif.GPSIFD.GPSLongitude]
                lat_ref = exif_dict["GPS"][piexif.GPSIFD.GPSLatitudeRef].decode('utf-8')
                lon_ref = exif_dict["GPS"][piexif.GPSIFD.GPSLongitudeRef].decode('utf-8')
                exif_data_for_js["latitude"] = dms_to_decimal(lat_dms, lat_ref)
                exif_data_for_js["longitude"] = dms_to_decimal(lon_dms, lon_ref)
            
            # Add other EXIF data to the JSON response for potential future use in JS
            if piexif.ImageIFD.Make in exif_dict["0th"]:
                exif_data_for_js["Make"] = exif_dict["0th"][piexif.ImageIFD.Make].decode('utf-8')
            if piexif.ImageIFD.Model in exif_dict["0th"]:
                exif_data_for_js["Model"] = exif_dict["0th"][piexif.ImageIFD.Model].decode('utf-8')
            if piexif.ExifIFD.DateTimeOriginal in exif_dict["Exif"]:
                exif_data_for_js["DateTimeOriginal"] = exif_dict["Exif"][piexif.ExifIFD.DateTimeOriginal].decode('utf-8')
            if piexif.ExifIFD.ExposureTime in exif_dict["Exif"]:
                exif_data_for_js["ExposureTime"] = format_rational(exif_dict["Exif"][piexif.ExifIFD.ExposureTime]) + " s"
            if piexif.ExifIFD.FNumber in exif_dict["Exif"]:
                exif_data_for_js["FNumber"] = "f/" + format_rational(exif_dict["Exif"][piexif.ExifIFD.FNumber])
            if piexif.ExifIFD.ISOSpeedRatings in exif_dict["Exif"]:
                exif_data_for_js["ISOSpeedRatings"] = exif_dict["Exif"][piexif.ExifIFD.ISOSpeedRatings]
            if piexif.ExifIFD.FocalLength in exif_dict["Exif"]:
                exif_data_for_js["FocalLength"] = format_rational(exif_dict["Exif"][piexif.ExifIFD.FocalLength]) + " mm"
            if piexif.ImageIFD.XResolution in exif_dict["0th"]:
                exif_data_for_js["XResolution"] = format_rational(exif_dict["0th"][piexif.ImageIFD.XResolution])
            if piexif.ImageIFD.YResolution in exif_dict["0th"]:
                exif_data_for_js["YResolution"] = format_rational(exif_dict["0th"][piexif.ImageIFD.YResolution])
            if piexif.ImageIFD.Artist in exif_dict["0th"]:
                exif_data_for_js["Artist"] = exif_dict["0th"][piexif.ImageIFD.Artist].decode('utf-8')
            if piexif.ImageIFD.Copyright in exif_dict["0th"]:
                exif_data_for_js["Copyright"] = exif_dict["0th"][piexif.ImageIFD.Copyright].decode('utf-8')
            if piexif.ExifIFD.PixelXDimension in exif_dict["Exif"]:
                exif_data_for_js["PixelXDimension"] = exif_dict["Exif"][piexif.ExifIFD.PixelXDimension]
            if piexif.ExifIFD.PixelYDimension in exif_dict["Exif"]:
                exif_data_for_js["PixelYDimension"] = exif_dict["Exif"][piexif.ExifIFD.PixelYDimension]
            
            # Image Dimensions from Pillow (not EXIF but useful for resolution display)
            exif_data_for_js["ImageWidth"] = img.width
            exif_data_for_js["ImageHeight"] = img.height

        return jsonify(exif_data_for_js)
    except Exception as e:
        print(f"Error getting EXIF GPS for {filename}: {e}")
        return jsonify({"error": f"Could not read EXIF GPS: {e}"}), 500


@app.route('/modify_exif', methods=['POST'])
def modify_exif():
    """
    Handles the POST request to modify EXIF data for a selected image.
    It reads the form data, updates the EXIF, and overwrites the original image.
    """
    # Get form data
    filename = request.form.get('filename')
    latitude_str = request.form.get('latitude')
    longitude_str = request.form.get('longitude')
    artist = request.form.get('artist')
    copyright_info = request.form.get('copyright')

    # Basic validation: ensure a filename is provided
    if not filename:
        return "No filename provided for modification.", 400

    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    # Check if the selected file actually exists
    if not os.path.exists(filepath):
        return f"File '{filename}' not found in the '{app.config['UPLOAD_FOLDER']}' directory.", 404

    try:
        # Open the image
        img = Image.open(filepath)
        exif_dict = {}

        # Load existing EXIF data if it exists in the image.
        # If not, initialize an empty EXIF dictionary for all IFDs.
        if "exif" in img.info:
            exif_dict = piexif.load(img.info["exif"])
        else:
            # Initialize all standard EXIF IFDs (Image File Directories)
            exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "Interop": {}, "1st": {}, "thumbnail": None}

        # --- Add/Modify GPS Data ---
        # Only proceed if both latitude and longitude are provided
        if latitude_str and longitude_str:
            try:
                latitude = float(latitude_str)
                longitude = float(longitude_str)

                # Convert decimal degrees to the DMS (Degrees, Minutes, Seconds) format required by EXIF
                lat_dms = decimal_to_dms(latitude)
                lon_dms = decimal_to_dms(longitude)

                # Set GPS tags in the GPS IFD
                exif_dict["GPS"][piexif.GPSIFD.GPSLatitudeRef] = get_gps_ref(latitude, True).encode('ascii')
                exif_dict["GPS"][piexif.GPSIFD.GPSLatitude] = lat_dms
                exif_dict["GPS"][piexif.GPSIFD.GPSLongitudeRef] = get_gps_ref(longitude, False).encode('ascii')
                exif_dict["GPS"][piexif.GPSIFD.GPSLongitude] = lon_dms
                exif_dict["GPS"][piexif.GPSIFD.GPSVersionID] = (2, 0, 0, 0) # Standard GPS version ID
                exif_dict["GPS"][piexif.GPSIFD.GPSAltitudeRef] = 0 # 0 for above sea level, 1 for below
                exif_dict["GPS"][piexif.GPSIFD.GPSAltitude] = (0, 1) # Default altitude to 0 meters

            except ValueError:
                return "Invalid latitude or longitude format. Please enter numbers.", 400

        # --- Add/Modify other EXIF data (0th IFD) ---
        # Encode strings to bytes as required by piexif
        if artist:
            exif_dict["0th"][piexif.ImageIFD.Artist] = artist.encode('utf-8')
        if copyright_info:
            exif_dict["0th"][piexif.ImageIFD.Copyright] = copyright_info.encode('utf-8')
        
        # Add a custom software tag to indicate this app modified the EXIF
        exif_dict["0th"][piexif.ImageIFD.Software] = b"Flask EXIF Editor by Gemini"

        # Dump the EXIF dictionary into bytes format suitable for saving
        exif_bytes = piexif.dump(exif_dict)

        # Overwrite the original image file
        img.save(filepath, exif=exif_bytes)

        # Redirect back to the main page to show the updated list
        return redirect(url_for('index'))

    except Exception as e:
        # Catch any errors during the EXIF modification and saving process
        return f"An error occurred during EXIF modification: {e}", 500

@app.route('/fulls/<filename>')
def serve_image(filename):
    """
    Serves image files directly from the 'fulls' directory.
    This allows the browser to display the images.
    """
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# --- Main execution block ---
if __name__ == '__main__':
    # Set up argument parsing
    parser = argparse.ArgumentParser(description='Flask EXIF Editor Application.')
    parser.add_argument('--fulls', type=str, default='fulls',
                        help='Path to the directory containing images (default: fulls)')
    parser.add_argument('--port', type=int, default=8000, # Changed default port to 8000
                        help='Port to host the application (default: 8000)')
    parser.add_argument('--host', type=str, default='127.0.0.1',
                        help='Host IP interface to host the application (default: 127.0.0.1)')
    
    args = parser.parse_args()

    # Configure the UPLOAD_FOLDER based on the --fulls argument
    app.config['UPLOAD_FOLDER'] = args.fulls

    # Ensure the 'fulls' directory exists based on the parsed argument
    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        os.makedirs(app.config['UPLOAD_FOLDER'])
        print(f"Created directory: {app.config['UPLOAD_FOLDER']}")

    # Run the Flask development server using parsed arguments
    app.run(host=args.host, port=args.port, debug=True)
