import os
from flask import Flask, render_template, request, redirect, url_for, send_from_directory
import piexif
from PIL import Image
import base64
import io
import argparse # Import the argparse module

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

                        # Extract and decode some common EXIF tags from the 0th IFD (Image File Directory)
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

                        # Extract and convert GPS data from the GPS IFD
                        if piexif.GPSIFD.GPSLatitude in exif_dict["GPS"] and \
                           piexif.GPSIFD.GPSLongitude in exif_dict["GPS"]:
                            lat_dms = exif_dict["GPS"][piexif.GPSIFD.GPSLatitude]
                            lon_dms = exif_dict["GPS"][piexif.GPSIFD.GPSLongitude]
                            lat_ref = exif_dict["GPS"][piexif.GPSIFD.GPSLatitudeRef].decode('utf-8')
                            lon_ref = exif_dict["GPS"][piexif.GPSIFD.GPSLongitudeRef].decode('utf-8')

                            # Convert DMS back to decimal degrees for display using custom function
                            latitude = dms_to_decimal(lat_dms, lat_ref)
                            longitude = dms_to_decimal(lon_dms, lon_ref)
                            exif_data["GPSLatitude"] = f"{latitude:.6f}" # Format to 6 decimal places
                            exif_data["GPSLongitude"] = f"{longitude:.6f}"

                except Exception as e:
                    # Log any errors encountered while reading EXIF data for a specific file
                    print(f"Error reading EXIF for {filename}: {e}")
                    exif_data["Error"] = f"Could not read EXIF: {e}"

                # Add the image filename and its extracted EXIF data to the list
                images.append({'filename': filename, 'exif': exif_data})
    except FileNotFoundError:
        # Handle the case where the 'fulls' directory does not exist
        return f"The '{app.config['UPLOAD_FOLDER']}' directory was not found. Please create it and place images inside, or specify a valid path using --fulls.", 500
    except Exception as e:
        # Catch any other unexpected errors during directory listing
        return f"An unexpected error occurred: {e}", 500

    # Render the index.html template, passing the list of images
    return render_template('exif.html', images=images)

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
    parser.add_argument('--port', type=int, default=8000,
                        help='Port to host the application (default: 5000)')
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
