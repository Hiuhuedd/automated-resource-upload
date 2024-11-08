require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const AWS = require('aws-sdk');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');

const app = express();

// Enable CORS for specific origins
app.use(cors({
  origin: [
    'https://brainstorm-resource-upload.onrender.com', 
    'https://bstorm-upload.netlify.app',
    'http://localhost:3000'
  ],
  credentials: true,
}));

app.use(bodyParser.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected successfully'))
.catch((err) => console.error('MongoDB connection error:', err));

// MongoDB schema for Resource
const ResourceSchema = new mongoose.Schema({
  fileURI: String,
  programCode: String,
  isCommonUnit: Boolean,
  unitCode: String,
  unitName: String,
  semester: Number,
  year: Number,
  resourceDate: Date,
  isProfessorEndorsed: Boolean,
  isExam: Boolean,
  isNotes: Boolean,
  unitProfessor: String,
});

const Resource = mongoose.model('Resource', ResourceSchema);

// Set up AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// New endpoint for generating, saving, and uploading resource content
app.post('/generate-and-upload', async (req, res) => {
  console.log(req.body)
  const { unitCode, unitName, isNotes } = req.body;

  try {
    // Generate AI content
    const response = await axios.post(
      "https://api.aimlapi.com/v1/chat/completions",
      {
        model: "gpt-4-turbo",
        messages: [
          {
            role: "system",
            content: `You are a university professor. Create a CAT out of 40 marks for this unit.No multiple-choice questions or instructions or text styling`,
          },
          {
            role: "user",
            content: `Unit Code: ${unitCode}, Unit Name: ${unitName}`,
          },
        ],
      temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.AIML_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const aiContent = response.data.choices[0].message.content;

    const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

 // Load the image as a Uint8Array (assuming you have the image file as a buffer)
 const imagePath = path.join(__dirname, 'logo.png');
 const imageBytes = fs.readFileSync(imagePath);

// Create PDF document
const pdfDoc = await PDFDocument.create();
const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
const timesRomanBoldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
const page = pdfDoc.addPage();
const { width, height } = page.getSize();

// Embed the image in the PDF
const pngImage = await pdfDoc.embedPng(imageBytes);
const imageWidth = 60; // Adjust width as desired
const imageHeight = 60; // Adjust height as desired

// Draw the image on the page (adjust x, y position as needed)
page.drawImage(pngImage, {
  x: (width - imageWidth) / 2, // Center the image horizontally
  y: height - 70, // Position below the header and subheader
  width: imageWidth,
  height: imageHeight,
});

    // Text content
    const header = `${unitCode} ${unitName}`.toUpperCase();
    const subHeader = isNotes ? 'NOTES' : 'CAT I SEM I 2023/2024';
    
    // Calculate the x-coordinate for centering the text
    const headerWidth = timesRomanBoldFont.widthOfTextAtSize(header, 14);
    const headerX = (width - headerWidth) / 2;
    
    const subHeaderWidth = timesRomanBoldFont.widthOfTextAtSize(subHeader, 12);
    const subHeaderX = (width - subHeaderWidth) / 2;
    
    // Draw the bold header
    page.drawText(header, {
      x: headerX,
      y: height - 90,
      size: 14,
      font: timesRomanBoldFont,
      color: rgb(0, 0, 0),
    });
    
    // Draw the underline for the header
    page.drawLine({
      start: { x: headerX, y: height - 92 },
      end: { x: headerX + headerWidth, y: height - 92 },
      thickness: 1,
      color: rgb(0, 0, 0),
    });
    
    // Draw the bold subheader
    page.drawText(subHeader, {
      x: subHeaderX,
      y: height - 110,
      size: 12,
      font: timesRomanBoldFont,
      color: rgb(0, 0, 0),
    });
    
    // Draw the underline for the subheader
    page.drawLine({
      start: { x: subHeaderX, y: height - 112 },
      end: { x: subHeaderX + subHeaderWidth, y: height - 112 },
      thickness: 1,
      color: rgb(0, 0, 0),
    });

    // Content body
    const textY = height - 150;
    page.drawText(aiContent, {
      x: 50,
      y: textY,
      size: 12,
      font: timesRomanFont,
      color: rgb(0, 0, 0),
      lineHeight: 20,
      maxWidth: width - 100,
    });

    // Save PDF as Buffer
    const pdfBuffer = await pdfDoc.save();

    // Upload PDF to S3
    const s3Params = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: `${Date.now()}_${unitCode}_resource.pdf`,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    };

    const s3Data = await s3.upload(s3Params).promise();

    // Save resource data to MongoDB
    const newResource = new Resource({
      fileURI: s3Data.Location,
      // programCode: unitCode.slice(0, 4), // Example logic for program code
      unitCode,
      unitName,
      isNotes,
      resourceDate: new Date(),
    });

    await newResource.save();

    res.status(200).json({
      message: 'Resource generated, uploaded, and saved successfully',
      resource: newResource,
    });
  } catch (error) {
    console.error('Error in generating or uploading resource:', error);
    res.status(500).json({ error: 'Failed to generate and upload resource' });
  }
});

// Start the server
app.listen(5000, () => {
  console.log('Server is running on port 5000');
});