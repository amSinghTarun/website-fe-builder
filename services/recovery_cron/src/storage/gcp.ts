import { Storage } from "@google-cloud/storage";
import unzipper from "unzipper";
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

const requiredWorkspaceFiles = ["package.json", "index.html"];

// Extract into staging so an incomplete archive never replaces the workspace.
export async function extractSnapshotArchive(
  archiveData: Uint8Array,
  destinationPath: string,
): Promise<void> {
  const destinationParent = path.dirname(destinationPath);
  await fs.mkdir(destinationParent, { recursive: true });

  const stagingPath = await fs.mkdtemp(
    path.join(destinationParent, ".sky-restore-"),
  );

  try {
    const archive = await unzipper.Open.buffer(Buffer.from(archiveData));
    await archive.extract({ path: stagingPath });

    const missingFiles: string[] = [];
    for (const fileName of requiredWorkspaceFiles) {
      try {
        await fs.access(path.join(stagingPath, fileName));
      } catch {
        missingFiles.push(fileName);
      }
    }

    if (missingFiles.length > 0) {
      throw new Error(
        `Snapshot is incomplete; missing required workspace files: ${missingFiles.join(", ")}`,
      );
    }

    await fs.rm(destinationPath, { recursive: true, force: true });
    await fs.rename(stagingPath, destinationPath);
  } catch (error) {
    await fs.rm(stagingPath, { recursive: true, force: true });
    throw error;
  }
}
// For more information on ways to initialize Storage, please see
// https://googleapis.dev/nodejs/storage/latest/Storage.html

export class gcpStore {
  private static instance: gcpStore;
  private static readonly storage = new Storage();
  private readonly bucketName = "lovable_backup_snapshots";
  // Creates a client from a Google service account key
  // const storage = new Storage({keyFilename: 'key.json'});

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new gcpStore();
    }
    return this.instance;
  }

  private async upsertBucket() {
    let [exists] = await gcpStore.storage.bucket(this.bucketName).exists();
    if (!exists) await gcpStore.storage.createBucket(this.bucketName);
  }

  //
  public async putDataInBucket(
    uploadData: Uint8Array,
    cloudFileName: string,
  ) {
    await this.upsertBucket();

    try {
      const file = gcpStore.storage
        .bucket(this.bucketName)
        .file(`${cloudFileName}`);
      await file.save(uploadData, {
        resumable: false,
        contentType: "application/zip",
      });

      // let file = gcpStore.storage
      //   .bucket(this.bucketName)
      //   .file(`${databaseProjectId}/${cloudFileName}`);

      // const archive = new ZipArchive({ zlib: { level: 4 } });
      // const gcsWriteStream = file.createWriteStream({
      //   metadata: {
      //     contentType: "application/zip",
      //   },
      // });

      // archive.pipe(gcsWriteStream);

      // archive.directory(sourceFileDestinarion, false);
      // archive.finalize();

      // await new Promise((resolve, reject) => {
      //   gcsWriteStream.on("error", (err) => {
      //     console.error("GCS Upload Error:", err);
      //     reject(err);
      //   });
      //   gcsWriteStream.on("finish", () => {
      //     console.log("Backup upload done");
      //     resolve(true);
      //   });
      // });

      console.log("BACKUP UPLOADED", file.name);
      return file;
    } catch (error) {
      console.log("CRON ERROR : UPLOADING PROJECT BACKUP", error);
      throw error;
    }
  }

  public async retrieveSnapshotData(
    databaseProjectId: string,
    destinationPath: string,
  ): Promise<string | null> {
    await this.upsertBucket();

    let [files] = await gcpStore.storage
      .bucket(this.bucketName)
      .getFiles({ prefix: databaseProjectId + "/" });

    files.sort(
      (a, b) =>
        new Date(b.metadata.timeCreated!).getTime() -
        new Date(a.metadata.timeCreated!).getTime(),
    );

    let latestZipFile = files[0];

    if (!latestZipFile) {
      return null;
    }

    const [archiveData] = await latestZipFile.download();
    await extractSnapshotArchive(archiveData, destinationPath);
    console.log("Snapshot restored and validated successfully");

    return latestZipFile.name;
  }
}
