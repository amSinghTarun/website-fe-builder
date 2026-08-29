import { backupCron } from "./service";
import { recovery } from "./service";
import { requireDatabaseProjectId } from "@sky/common";

const databaseProjectId = requireDatabaseProjectId();

// RECOVERY
// -----------------------------
// go to the cloud storage
// check if any object for this project exists
//
// NOTE : For recovery and cron, we are saving .zip in the object store not the build(i.e js, html and css)
//
// Check if the volume exist - as we will be in the same directory
// if not get the snapshot from storage
// store in the directory of the volume
/**
    Question is how do you run tool calls after getting the history from db, as tools are stored in the agentSerevr
    There should be an API which accept a tool calls and just loop through them.
    http://<target-service-name>.default.svc.cluster.local:<port>/<api-path>
*/
await recovery(databaseProjectId);

// CRON
// -----------------------------
// create bucket if not exist
// write the volume data in a object store
backupCron(databaseProjectId);
