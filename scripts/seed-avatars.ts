import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getPublicS3Client } from "../lib/b2/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const PUBLIC_BUCKET_NAME = process.env.PUBLIC_S3_BUCKET || "xenopublic";
const TOTAL_AVATARS = 1000;
const CONCURRENCY = 20;

async function fetchAndUploadAvatar(index: number) {
  const seed = Math.random().toString(36).substring(7) + index;
  const url = `https://api.dicebear.com/10.x/micah/svg?seed=${seed}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch avatar: ${response.statusText}`);
    }
    
    const svgContent = await response.text();
    const key = `avatars/avatar-${index}.svg`;

    const command = new PutObjectCommand({
      Bucket: PUBLIC_BUCKET_NAME,
      Key: key,
      Body: svgContent,
      ContentType: "image/svg+xml",
      // ACL: "public-read", // Uncomment if your bucket requires explicit ACL
    });

    const client = getPublicS3Client();
    await client.send(command);
    
    console.log(`[${index}/${TOTAL_AVATARS}] Uploaded ${key}`);
  } catch (error) {
    console.error(`[${index}/${TOTAL_AVATARS}] Error uploading avatar:`, error);
  }
}

async function main() {
  console.log(`Starting to seed ${TOTAL_AVATARS} avatars to bucket: ${PUBLIC_BUCKET_NAME}...`);
  
  // Create an array of tasks
  const tasks = Array.from({ length: TOTAL_AVATARS }, (_, i) => i + 1);
  
  // Process in chunks to respect concurrency limit
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const chunk = tasks.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map((index) => fetchAndUploadAvatar(index)));
  }
  
  console.log("Seeding complete!");
}

main().catch(console.error);
