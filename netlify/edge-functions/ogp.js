const PROJECT_ID = "attendance-management-e55de";
const API_KEY = "AIzaSyCQQ77LCK3BOUO1t1MfGFy6ZHKp4UuDT0I";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getStringField(fields, key) {
  const f = fields?.[key];
  if (!f) return "";
  if (typeof f.stringValue === "string") return f.stringValue;
  return "";
}

async function fetchProjectAndCounts(projectId) {
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const keyParam = `key=${encodeURIComponent(API_KEY)}`;

  const projRes = await fetch(`${baseUrl}/projects/${encodeURIComponent(projectId)}?${keyParam}`);
  if (!projRes.ok) {
    return null;
  }
  const projJson = await projRes.json();
  const projectName = getStringField(projJson.fields, "name") || "出欠管理・共有ボード";

  let countOk = 0;
  let countNg = 0;
  let countUndecided = 0;
  let total = 0;
  let pageToken = "";

  do {
    const tokenQuery = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const membersUrl = `${baseUrl}/projects/${encodeURIComponent(projectId)}/members?pageSize=300&${keyParam}${tokenQuery}`;
    const membersRes = await fetch(membersUrl);
    if (!membersRes.ok) break;

    const membersJson = await membersRes.json();
    const docs = membersJson.documents || [];
    for (const d of docs) {
      total += 1;
      const mark = getStringField(d.fields, "mark");
      if (mark === "〇") countOk += 1;
      else if (mark === "×") countNg += 1;
      else countUndecided += 1;
    }
    pageToken = membersJson.nextPageToken || "";
  } while (pageToken);

  return {
    projectName,
    total,
    countOk,
    countNg,
    countUndecided
  };
}

export default async (request, context) => {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project");

  // ?project= がない場合は通常の静的 index.html をそのまま返す
  if (!projectId) {
    return context.next();
  }

  const originResponse = await context.next();
  const contentType = originResponse.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return originResponse;
  }

  let html = await originResponse.text();

  let ogTitle = `${projectId} | 出欠管理・共有ボード`;
  let ogDescription = "出欠状況を確認・更新できる共有ボードです。";

  try {
    const data = await fetchProjectAndCounts(projectId);
    if (data) {
      ogTitle = `${data.projectName}｜出欠管理ボード`;
      ogDescription = `参加(〇): ${data.countOk}名 ／ 不参加(×): ${data.countNg}名 ／ 未定(△): ${data.countUndecided}名（全${data.total}名）`;
    }
  } catch (err) {
    console.error("OGP Firestore fetch error:", err);
  }

  const safeTitle = escapeHtml(ogTitle);
  const safeDesc = escapeHtml(ogDescription);
  const safeUrl = escapeHtml(url.toString());

  const ogTags = `
  <title>${safeTitle}</title>
  <meta property="og:type" content="website">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:url" content="${safeUrl}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDesc}">
  <meta name="description" content="${safeDesc}">`;

  // 既存の <title> があれば置換し、</head> の直前に OGP タグを挿入
  if (/<title>.*?<\/title>/i.test(html)) {
    html = html.replace(/<title>.*?<\/title>/i, `<title>${safeTitle}</title>`);
  }
  html = html.replace(/<\/head>/i, `${ogTags}\n</head>`);

  return new Response(html, {
    status: originResponse.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate"
    }
  });
};