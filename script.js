// --- DOM Elements ---
const baseInput = document.getElementById('base-input');
const designInput = document.getElementById('design-input');
const baseFilename = document.getElementById('base-filename');
const designFilename = document.getElementById('design-filename');
const designPreview = document.getElementById('design-preview');
const applyButton = document.getElementById('apply-button');
const resetButton = document.getElementById('reset-button');
const saveButton = document.getElementById('save-button');
const infoText = document.getElementById('info-text');
const canvas = document.getElementById('mockup-canvas');
const ctx = canvas.getContext('2d');

// --- State Variables ---
let baseImage = null; // Stores the loaded base Image object
let designImage = null; // Stores the loaded design Image object
let baseImageDataUrl = null; // Store data URL to redraw easily
let targetPoints = []; // Array to store {x, y} points clicked on canvas
let displayScale = 1; // Ratio of original image size to displayed size
const MAX_CANVAS_DIM = 800; // Max width/height for canvas display

// --- Perspective Transform Helper (Solves Ax=B for x) ---
// Simplified matrix math for this specific 8x8 system
// Based on https://stackoverflow.com/a/13289338/1406071 and Python version
function getPerspectiveTransformMatrix(srcPts, dstPts) {
    if (srcPts.length !== 4 || dstPts.length !== 4) {
        throw new Error("Need 4 source and 4 destination points.");
    }

    const P = [ // Create the 8x8 matrix P
        [srcPts[0].x, srcPts[0].y, 1, 0, 0, 0, -srcPts[0].x * dstPts[0].x, -srcPts[0].y * dstPts[0].x],
        [0, 0, 0, srcPts[0].x, srcPts[0].y, 1, -srcPts[0].x * dstPts[0].y, -srcPts[0].y * dstPts[0].y],
        [srcPts[1].x, srcPts[1].y, 1, 0, 0, 0, -srcPts[1].x * dstPts[1].x, -srcPts[1].y * dstPts[1].x],
        [0, 0, 0, srcPts[1].x, srcPts[1].y, 1, -srcPts[1].x * dstPts[1].y, -srcPts[1].y * dstPts[1].y],
        [srcPts[2].x, srcPts[2].y, 1, 0, 0, 0, -srcPts[2].x * dstPts[2].x, -srcPts[2].y * dstPts[2].x],
        [0, 0, 0, srcPts[2].x, srcPts[2].y, 1, -srcPts[2].x * dstPts[2].y, -srcPts[2].y * dstPts[2].y],
        [srcPts[3].x, srcPts[3].y, 1, 0, 0, 0, -srcPts[3].x * dstPts[3].x, -srcPts[3].y * dstPts[3].x],
        [0, 0, 0, srcPts[3].x, srcPts[3].y, 1, -srcPts[3].x * dstPts[3].y, -srcPts[3].y * dstPts[3].y]
    ];

    const R = [ // Result vector R
        dstPts[0].x, dstPts[0].y, dstPts[1].x, dstPts[1].y,
        dstPts[2].x, dstPts[2].y, dstPts[3].x, dstPts[3].y
    ];

    // Gaussian elimination to solve P * H = R for H (the transform coeffs)
    // (Simplified implementation - assumes non-singular matrix)
    for (let i = 0; i < 8; i++) {
        let maxRow = i;
        for (let k = i + 1; k < 8; k++) {
            if (Math.abs(P[k][i]) > Math.abs(P[maxRow][i])) {
                maxRow = k;
            }
        }
        [P[i], P[maxRow]] = [P[maxRow], P[i]];
        [R[i], R[maxRow]] = [R[maxRow], R[i]];

        for (let k = i + 1; k < 8; k++) {
            const factor = P[k][i] / P[i][i];
            R[k] -= factor * R[i];
            for (let j = i; j < 8; j++) {
                P[k][j] -= factor * P[i][j];
            }
        }
    }

    const H = new Array(8); // The coefficients h11 to h32
    for (let i = 7; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < 8; j++) {
            sum += P[i][j] * H[j];
        }
        H[i] = (R[i] - sum) / P[i][i];
    }

    // Return as a 3x3 matrix (h33 is 1)
    // This is the format needed for some drawing methods, although
    // we might only use the coefficients directly for texture mapping later.
    // Note: Canvas transform uses [a, b, c, d, e, f] which is different.
    // This matrix represents the *inverse* mapping (destination to source) needed for texture mapping.
    // For direct drawing with setTransform, need to compute the forward matrix and possibly invert.
     // Let's return the 8 coefficients as needed by some algorithms
     // or just use them to implement the triangle method below
    return H; // h11, h12, h13, h21, h22, h23, h31, h32
}


// --- Image Loading and Drawing ---
function loadImage(file, isBaseImage) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject("No file selected");
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                if (isBaseImage) {
                    baseImage = img;
                    baseImageDataUrl = e.target.result; // Store for redraw
                    drawBaseImage(); // Draw initial base image
                    resetPoints(); // Clear points when new base is loaded
                } else {
                    designImage = img;
                    designPreview.src = e.target.result;
                    designPreview.style.display = 'block';
                }
                updateApplyButtonState();
                resolve(img); // Resolve the promise with the Image object
            };
            img.onerror = (err) => reject(`Image loading error: ${err}`);
            img.src = e.target.result; // Trigger image loading
        };
        reader.onerror = (err) => reject(`File reading error: ${err}`);
        reader.readAsDataURL(file); // Read file as Data URL
    });
}

function drawBaseImage() {
    if (!baseImage) return;

    // Calculate display size, maintaining aspect ratio
    const ratio = Math.min(MAX_CANVAS_DIM / baseImage.naturalWidth, MAX_CANVAS_DIM / baseImage.naturalHeight, 1);
    const dispWidth = baseImage.naturalWidth * ratio;
    const dispHeight = baseImage.naturalHeight * ratio;
    displayScale = ratio; // Store the scale factor

    // Set canvas size (clears it)
    canvas.width = dispWidth;
    canvas.height = dispHeight;

    // Draw the scaled image
    ctx.drawImage(baseImage, 0, 0, dispWidth, dispHeight);
    infoText.textContent = "Click 4 points on the image: Top-Left, Top-Right, Bottom-Right, Bottom-Left.";
}

function drawPoints() {
    if (!baseImage) return; // Don't draw if no base image

    // Redraw base image first to clear old points/mockup
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

    // Draw circles for points
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)'; // Semi-transparent red
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    targetPoints.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); // Draw a circle of radius 5
        ctx.fill();
        ctx.stroke();
    });

    // Update info text based on points count
    const pointNames = ["Top-Left", "Top-Right", "Bottom-Right", "Bottom-Left"];
    if (targetPoints.length < 4) {
        infoText.textContent = `Point ${targetPoints.length} added. Click ${pointNames[targetPoints.length]}.`;
    } else {
        infoText.textContent = "4 points selected. Load Design Image or Apply Mockup.";
    }
}

// --- Event Handlers ---
baseInput.addEventListener('change', async (e) => {
    try {
        await loadImage(e.target.files[0], true);
        baseFilename.textContent = e.target.files[0].name;
    } catch (error) {
        console.error("Error loading base image:", error);
        infoText.textContent = `Error loading base image: ${error}`;
        baseFilename.textContent = "Error loading";
        baseImage = null; // Reset state
        resetPoints();
        updateApplyButtonState();
    }
});

designInput.addEventListener('change', async (e) => {
     try {
        await loadImage(e.target.files[0], false);
        designFilename.textContent = e.target.files[0].name;
    } catch (error)        {
        console.error("Error loading design image:", error);
        infoText.textContent = `Error loading design image: ${error}`;
        designFilename.textContent = "Error loading";
        designImage = null; // Reset state
        designPreview.style.display = 'none';
        updateApplyButtonState();
    }
});

canvas.addEventListener('click', (e) => {
    if (!baseImage) {
        infoText.textContent = "Please load a base image first!";
        return;
    }
    if (targetPoints.length >= 4) {
        infoText.textContent = "4 points already selected. Reset points to select new ones.";
        return;
    }

    // Get click coordinates relative to the canvas element
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    targetPoints.push({ x, y });
    drawPoints(); // Redraw base image and all points
    updateApplyButtonState();
});

resetButton.addEventListener('click', () => {
    resetPoints();
    if (baseImage) {
        drawBaseImage(); // Redraw original base image
    } else {
         // Clear canvas if no base image is loaded
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 300; // Reset to default size or hide
        canvas.height = 150;
        infoText.textContent = "Load Base Image first.";
    }
});

applyButton.addEventListener('click', () => {
    if (!baseImage || !designImage || targetPoints.length !== 4) {
        infoText.textContent = "Error: Need Base Image, Design Image, and 4 points selected.";
        return;
    }
    applyMockup();
});

saveButton.addEventListener('click', () => {
    if (!baseImage) return; // Should not happen if button is visible

    // Create a temporary link element
    const link = document.createElement('a');

    // Generate filename (replace extension, add suffix)
    const baseName = baseInput.files[0]?.name.replace(/\.[^/.]+$/, "") || "mockup";
    link.download = `${baseName}_mockup.png`; // Suggest PNG format

    // Get the canvas content as a data URL
    // Ensure quality by using PNG; for JPG use 'image/jpeg'
    link.href = canvas.toDataURL('image/png');

    // Programmatically click the link to trigger download
    link.click();

     // Optional: Clean up the link element
    link.remove();
});


// --- Core Logic ---
function resetPoints() {
    targetPoints = [];
    saveButton.style.display = 'none'; // Hide save button on reset
    if(baseImage) { // Only redraw points if base image exists
       drawPoints(); // Redraws base and 0 points
       infoText.textContent = "Points reset. Click 4 points on the image.";
    }
    updateApplyButtonState();
}

function updateApplyButtonState() {
    if (baseImage && designImage && targetPoints.length === 4) {
        applyButton.disabled = false;
    } else {
        applyButton.disabled = true;
    }
    // Keep save button hidden until mockup is applied
    // saveButton.style.display = 'none';
}


// --- Apply Mockup (Using Triangle Subdivision - Canvas API Friendly) ---
function applyMockup() {
    // 1. Define Source & Destination Quads
    const srcW = designImage.naturalWidth;
    const srcH = designImage.naturalHeight;
    const srcCorners = [ {x:0, y:0}, {x:srcW, y:0}, {x:srcW, y:h:srcH}, {x:0, y:srcH} ]; // TL, TR, BR, BL
    const dstCorners = targetPoints; // TL, TR, BR, BL (from clicks, in display coords)

    // 2. Redraw Base Image (clears previous mockup/points)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

    // 3. Draw the Design using two textured triangles
    // Triangle 1: TL, TR, BL of the source -> TL, TR, BL of the destination
    drawTexturedTriangle(
        designImage,
        srcCorners[0], srcCorners[1], srcCorners[3], // Source tri
        dstCorners[0], dstCorners[1], dstCorners[3]  // Dest tri
    );

    // Triangle 2: TR, BR, BL of the source -> TR, BR, BL of the destination
    drawTexturedTriangle(
        designImage,
        srcCorners[1], srcCorners[2], srcCorners[3], // Source tri
        dstCorners[1], dstCorners[2], dstCorners[3]  // Dest tri
    );

    infoText.textContent = "Mockup applied! Reset points or save the result.";
    saveButton.style.display = 'inline-block'; // Show save button
}

// Helper to draw one textured triangle
// Uses affine transform approximation for perspective within the triangle
function drawTexturedTriangle(img, srcP0, srcP1, srcP2, dstP0, dstP1, dstP2) {
    ctx.save(); // Save current context state (transforms, clipping)

    // Clip to the destination triangle area
    ctx.beginPath();
    ctx.moveTo(dstP0.x, dstP0.y);
    ctx.lineTo(dstP1.x, dstP1.y);
    ctx.lineTo(dstP2.x, dstP2.y);
    ctx.closePath();
    // ctx.stroke(); // Optional: outline the triangle
    ctx.clip(); // Restrict drawing to within this triangle path

    // Calculate affine transform matrix mapping source to destination triangle
    // This is a simplified version of perspective transform calculations
    // It maps (0,0), (1,0), (0,1) to dstP0, dstP1, dstP2 after translating srcP0 to origin
    // See: https://stackoverflow.com/questions/4774172/image-manipulation-and-texture-mapping-using-html5-canvas

    const x0 = srcP0.x, y0 = srcP0.y;
    const x1 = srcP1.x, y1 = srcP1.y;
    const x2 = srcP2.x, y2 = srcP2.y;

    const u0 = dstP0.x, v0 = dstP0.y;
    const u1 = dstP1.x, v1 = dstP1.y;
    const u2 = dstP2.x, v2 = dstP2.y;

    // Calculate vectors for source and destination triangles relative to first point
    const dx1 = x1 - x0, dy1 = y1 - y0;
    const dx2 = x2 - x0, dy2 = y2 - y0;
    const du1 = u1 - u0, dv1 = v1 - v0;
    const du2 = u2 - u0, dv2 = v2 - v0;

    // Calculate determinant of source vectors
    const det = dx1 * dy2 - dx2 * dy1;

    if (Math.abs(det) < 1e-8) { // Check for degenerate source triangle
         console.warn("Degenerate source triangle, skipping draw.");
         ctx.restore();
         return;
    }

    // Calculate affine matrix elements (a, b, c, d, e, f)
    // such that [u] = [a c e] [x]
    //           [v]   [b d f] [y]
    //           [1]   [0 0 1] [1]
    // a = (du1 * dy2 - du2 * dy1) / det;
    // b = (dv1 * dy2 - dv2 * dy1) / det;
    // c = (du2 * dx1 - du1 * dx2) / det;
    // d = (dv2 * dx1 - dv1 * dx2) / det;
    // e = u0 - a * x0 - c * y0;
    // f = v0 - b * x0 - d * y0;


    // Apply the calculated transform
    ctx.transform(a, b, c, d, e, f);

    // Draw the *entire* source image. The clipping and transform handle the rest.
    ctx.drawImage(img, 0, 0);

    ctx.restore(); // Restore context state (remove clip and transform)
}


// --- Initial Setup ---
updateApplyButtonState(); // Ensure button is disabled initially
infoText.textContent = "Load Base Image to start.";
