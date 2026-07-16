import * as FileSystem from 'expo-file-system';
import JSZip from 'jszip';

// Reads a .epub (zip) file, pulls title/author from the OPF, and extracts
// the cover image to local storage so it can be shown in the library grid.
export async function extractEpubMetadata(fileUri, bookId) {
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const zip = await JSZip.loadAsync(base64, { base64: true });

  // 1. Find the OPF path via META-INF/container.xml
  const containerXml = await zip.file('META-INF/container.xml').async('text');
  const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
  const opfPath = opfPathMatch ? opfPathMatch[1] : null;
  if (!opfPath) return { title: 'Unknown Title', author: 'Unknown', coverPath: null };

  const opfXml = await zip.file(opfPath).async('text');
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/);
  const authorMatch = opfXml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/);

  const title = titleMatch ? titleMatch[1].trim() : 'Unknown Title';
  const author = authorMatch ? authorMatch[1].trim() : 'Unknown Author';

  // 2. Try to find the cover image reference
  let coverPath = null;
  const coverMetaMatch = opfXml.match(/<meta[^>]*name="cover"[^>]*content="([^"]+)"/);
  let coverId = coverMetaMatch ? coverMetaMatch[1] : null;

  let coverHref = null;
  if (coverId) {
    const itemRegex = new RegExp(`<item[^>]*id="${coverId}"[^>]*href="([^"]+)"`);
    const itemMatch = opfXml.match(itemRegex);
    if (itemMatch) coverHref = itemMatch[1];
  }
  // Fallback: look for an item with properties="cover-image"
  if (!coverHref) {
    const propMatch = opfXml.match(/<item[^>]*properties="cover-image"[^>]*href="([^"]+)"/);
    if (propMatch) coverHref = propMatch[1];
  }

  if (coverHref) {
    const fullCoverPath = opfDir + coverHref;
    const coverFile = zip.file(fullCoverPath);
    if (coverFile) {
      const coverBase64 = await coverFile.async('base64');
      const ext = coverHref.split('.').pop();
      const destPath = `${FileSystem.documentDirectory}covers/book_${bookId || Date.now()}.${ext}`;
      await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}covers`, { intermediates: true }).catch(() => {});
      await FileSystem.writeAsStringAsync(destPath, coverBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      coverPath = destPath;
    }
  }

  return { title, author, coverPath };
}

// Copies a picked EPUB file into permanent app storage so it survives reloads.
export async function importEpubFile(pickedFileUri, originalName) {
  const destDir = `${FileSystem.documentDirectory}books/`;
  await FileSystem.makeDirectoryAsync(destDir, { intermediates: true }).catch(() => {});
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const destPath = `${destDir}${Date.now()}_${safeName}`;
  await FileSystem.copyAsync({ from: pickedFileUri, to: destPath });
  return destPath;
}
