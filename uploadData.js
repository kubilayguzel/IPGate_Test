// uploadData.js
const admin = require('firebase-admin');
const serviceAccount = require('./ip-manager-production-firebase-adminsdk-fbsvc-d2ba79090c.json'); // Kendi JSON dosya yolunuzu buraya yazın
const transactionTypesData = require('./data/transactionTypes.json'); // transactionTypes JSON dosyasının yolu
const documentDesignationsData = require('./data/documentDesignations.json'); // documentDesignations JSON dosyasının yolu

// Firebase Admin SDK'yı başlatma
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function uploadCollection(collectionName, dataArray) {
  console.log(`Uploading data to collection: ${collectionName}`);
  let successCount = 0;
  let errorCount = 0;

  for (const item of dataArray) {
    if (!item.id) {
      console.warn(`Skipping item without 'id' in ${collectionName}:`, item);
      errorCount++;
      continue;
    }
    try {
      await db.collection(collectionName).doc(item.id).set(item);
      successCount++;
      // console.log(`Document ${item.id} added to ${collectionName}`);
    } catch (error) {
      console.error(`Error adding document ${item.id} to ${collectionName}:`, error);
      errorCount++;
    }
  }
  console.log(`Finished uploading to ${collectionName}. Success: ${successCount}, Failed: ${errorCount}`);
}

async function main() {
  try {
    // transactionTypes koleksiyonunu yükle
    await uploadCollection('transactionTypes', transactionTypesData);
    // documentDesignations koleksiyonunu yükle
    await uploadCollection('documentDesignations', documentDesignationsData);
    console.log('All data upload processes finished.');
  } catch (error) {
    console.error('An error occurred during main upload process:', error);
  }
}

main().then(() => {
  console.log('Script finished successfully.');
  process.exit(0);
}).catch((err) => {
  console.error('Script terminated with error:', err);
  process.exit(1);
});