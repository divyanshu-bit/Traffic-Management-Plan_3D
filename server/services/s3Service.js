const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const dotenv = require('dotenv');

dotenv.config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Upload a file (like a PDF plan) to the cloud
 */
exports.uploadPlan = async (fileName, fileBuffer, contentType = 'application/pdf') => {
  const params = {
    Bucket: process.env.AWS_S3_BUCKET,
    Key: `plans/${fileName}`,
    Body: fileBuffer,
    ContentType: contentType,
  };

  try {
    const data = await s3Client.send(new PutObjectCommand(params));
    return { 
      success: true, 
      key: params.Key,
      s3Url: `https://${params.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${params.Key}`
    };
  } catch (err) {
    console.error("S3 Upload Error:", err);
    throw new Error("Could not upload file to cloud warehouse.");
  }
};

/**
 * Generate a private, temporary link for a user to download their PDF
 */
exports.getDownloadLink = async (fileKey) => {
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key: fileKey,
  });

  // Link expires in 1 hour
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
};
