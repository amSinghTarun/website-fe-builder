import { Storage } from "@google-cloud/storage";
import unzipper from "unzipper";
import "dotenv/config";
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
    uploadData: Uint8Array<ArrayBuffer>,
    cloudFileName: string,
  ) {
    await this.upsertBucket();

    try {
      let file = await gcpStore.storage
        .bucket(this.bucketName)
        .file(`${cloudFileName}`)
        .create(uploadData);

      // let file = gcpStore.storage
      //   .bucket(this.bucketName)
      //   .file(`${projectId}/${cloudFileName}`);

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

      console.log("BACKUP UPLOADED", file);
      return file;
    } catch (error) {
      console.log("CRON ERROR : UPLOADING PROJECT BACKUP", error);
      throw error;
    }
  }

  public async retrieveSnapshotData(
    projectId: string,
    destinationPath: string,
  ): Promise<string | null> {
    await this.upsertBucket();

    let [files] = await gcpStore.storage
      .bucket(this.bucketName)
      .getFiles({ prefix: projectId + "/" });

    files.sort(
      (a, b) =>
        new Date(b.metadata.timeCreated!).getTime() -
        new Date(a.metadata.timeCreated!).getTime(),
    );

    let latestZipFile = files[0];

    if (!latestZipFile) {
      return null;
    }

    await new Promise((resolve, reject) => {
      latestZipFile
        .createReadStream()
        .pipe(unzipper.Extract({ path: destinationPath }))
        .on("finish", () => {
          console.log("Snapshot restored successfully");
          resolve(true);
        })
        .on("error", (error) => {
          console.error("Snapshot restore error:", error);
          reject(error);
        });
    });
    return latestZipFile.name;
  }
}
