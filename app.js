const config = window.APP_CONFIG || {};

const state = {
  idToken: "",
  user: null,
  masterData: {
    departments: ["วิชาการ", "งบประมาณ", "บุคคล", "บริหารทั่วไป"],
    fundSources: ["เงินอุดหนุน", "เงินรายได้สถานศึกษา", "เงินโครงการ"],
  },
  requests: [],
};

const requestTypeLabel = {
  purchase: "จัดซื้อ",
  hire: "จัดจ้าง",
  travel: "ไปราชการ",
};

const statusLabel = {
  draft: "ร่าง",
  pending_review: "รอตรวจสอบ",
  pending_approval: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
};

const viewTitle = {
  dashboard: "ภาพรวม",
  "new-request": "สร้างคำขอ",
  requests: "รายการคำขอ",
  admin: "ผู้ดูแล",
};

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindForm();
  bindFilters();
  renderMasterData();
  setRequestTypeVisibility("purchase");
  checkApiHealth();
  initGoogleLogin();
});

function bindNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });
}

function bindForm() {
  const form = document.getElementById("requestForm");
  form.requestType.addEventListener("change", (event) => setRequestTypeVisibility(event.target.value));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitRequest("pending_review");
  });

  document.querySelector("[data-save-draft]").addEventListener("click", async () => {
    await submitRequest("draft");
  });

  document.getElementById("refreshAdminButton").addEventListener("click", loadRequests);
  document.getElementById("signOutButton").addEventListener("click", signOut);
}

function bindFilters() {
  document.getElementById("searchInput").addEventListener("input", renderRequestsTable);
  document.getElementById("statusFilter").addEventListener("change", renderRequestsTable);
}

function initGoogleLogin() {
  if (!config.GOOGLE_CLIENT_ID || config.GOOGLE_CLIENT_ID.startsWith("YOUR_")) {
    toast("กรุณาตั้งค่า GOOGLE_CLIENT_ID ใน config.js");
    return;
  }

  waitForGoogleIdentity()
    .then(() => {
      window.google.accounts.id.initialize({
        client_id: config.GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
      });

      window.google.accounts.id.renderButton(document.getElementById("googleSignInButton"), {
        theme: "filled_blue",
        size: "large",
        shape: "pill",
        text: "signin_with",
      });
    })
    .catch(() => toast("โหลด Google Login ไม่สำเร็จ"));
}

async function handleCredentialResponse(response) {
  state.idToken = response.credential;
  const payload = decodeJwt(response.credential);

  if (config.SCHOOL_DOMAIN && payload.hd !== config.SCHOOL_DOMAIN) {
    toast("บัญชี Google นี้ไม่อยู่ในโดเมนที่อนุญาต");
    signOut();
    return;
  }

  try {
    const profile = await api("login", { idToken: state.idToken });
    state.user = profile.user;
    renderProfile(payload);
    await loadMasterData();
    await loadRequests();
    toast("เข้าสู่ระบบสำเร็จ");
  } catch (error) {
    toast(error.message || "เข้าสู่ระบบไม่สำเร็จ");
  }
}

async function checkApiHealth() {
  const status = document.getElementById("apiStatus");
  if (!config.APPS_SCRIPT_URL || config.APPS_SCRIPT_URL.startsWith("YOUR_")) {
    status.textContent = "ยังไม่ได้ตั้งค่า API";
    return;
  }

  try {
    const result = await api("ping", {}, false);
    status.textContent = result.ok ? "API พร้อมใช้งาน" : "API ไม่พร้อม";
  } catch {
    status.textContent = "เชื่อมต่อ API ไม่สำเร็จ";
  }
}

async function loadMasterData() {
  const result = await api("masterData", {});
  state.masterData = result.masterData;
  renderMasterData();
}

async function loadRequests() {
  const result = await api("listRequests", {});
  state.requests = result.requests || [];
  renderDashboard();
  renderRequestsTable();
  renderAdminQueue();
}

async function submitRequest(status) {
  if (!state.user) {
    toast("กรุณาเข้าสู่ระบบก่อนส่งคำขอ");
    return;
  }

  const form = document.getElementById("requestForm");
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.status = status;
  payload.budget = Number(payload.budget || 0);
  payload.travelerCount = Number(payload.travelerCount || 0);

  try {
    await api("createRequest", { request: payload });
    form.reset();
    setRequestTypeVisibility("purchase");
    await loadRequests();
    showView(status === "draft" ? "requests" : "dashboard");
    toast(status === "draft" ? "บันทึกร่างแล้ว" : "ส่งคำขอแล้ว");
  } catch (error) {
    toast(error.message || "บันทึกข้อมูลไม่สำเร็จ");
  }
}

async function updateStatus(requestId, status) {
  try {
    await api("updateStatus", { requestId, status });
    await loadRequests();
    toast("อัปเดตสถานะแล้ว");
  } catch (error) {
    toast(error.message || "อัปเดตสถานะไม่สำเร็จ");
  }
}

function renderProfile(jwtPayload) {
  document.getElementById("loginBox").classList.add("hidden");
  document.getElementById("profileBox").classList.remove("hidden");
  document.getElementById("profileName").textContent = state.user?.name || jwtPayload.name || "-";
  document.getElementById("profileRole").textContent = roleLabel(state.user?.role || "requester");
  document.getElementById("profileImage").src = jwtPayload.picture || "";
}

function renderMasterData() {
  fillSelect("departmentSelect", state.masterData.departments);
  fillSelect("fundSourceSelect", state.masterData.fundSources);
}

function renderDashboard() {
  const counts = state.requests.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    { draft: 0, pending_review: 0, pending_approval: 0, approved: 0, rejected: 0 },
  );

  document.getElementById("statDraft").textContent = counts.draft || 0;
  document.getElementById("statPending").textContent =
    (counts.pending_review || 0) + (counts.pending_approval || 0);
  document.getElementById("statApproved").textContent = counts.approved || 0;
  document.getElementById("statRejected").textContent = counts.rejected || 0;

  const recent = state.requests.slice(0, 5);
  document.getElementById("recentRequests").innerHTML = recent.length
    ? recent.map(renderRequestItem).join("")
    : "ยังไม่มีคำขอ";
}

function renderRequestsTable() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const status = document.getElementById("statusFilter").value;
  const rows = state.requests.filter((item) => {
    const text = `${item.title} ${item.requestType} ${item.status}`.toLowerCase();
    return (!status || item.status === status) && (!query || text.includes(query));
  });

  const container = document.getElementById("requestsTable");
  if (!rows.length) {
    container.className = "table-wrap empty-state";
    container.textContent = "ไม่พบรายการ";
    return;
  }

  container.className = "table-wrap";
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>เลขคำขอ</th>
          <th>ประเภท</th>
          <th>เรื่อง</th>
          <th>งบประมาณ</th>
          <th>สถานะ</th>
          <th>PDF</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (item) => `
              <tr>
                <td>${escapeHtml(item.requestId)}</td>
                <td>${requestTypeLabel[item.requestType] || item.requestType}</td>
                <td>${escapeHtml(item.title)}</td>
                <td>${formatMoney(item.budget)}</td>
                <td><span class="badge">${statusLabel[item.status] || item.status}</span></td>
                <td>${item.pdfUrl ? `<a href="${item.pdfUrl}" target="_blank" rel="noreferrer">เปิด PDF</a>` : "-"}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderAdminQueue() {
  const canReview = ["admin", "reviewer", "approver"].includes(state.user?.role);
  const queue = state.requests.filter((item) =>
    ["pending_review", "pending_approval"].includes(item.status),
  );
  const container = document.getElementById("adminQueue");

  if (!canReview) {
    container.className = "request-list empty-state";
    container.textContent = "เฉพาะผู้มีสิทธิ์ตรวจสอบหรืออนุมัติ";
    return;
  }

  if (!queue.length) {
    container.className = "request-list empty-state";
    container.textContent = "ไม่มีรายการรอดำเนินการ";
    return;
  }

  container.className = "request-list";
  container.innerHTML = queue
    .map(
      (item) => `
      <article class="request-item">
        <strong>${escapeHtml(item.title)}</strong>
        <div class="request-meta">
          <span>${requestTypeLabel[item.requestType] || item.requestType}</span>
          <span>${formatMoney(item.budget)}</span>
          <span>${statusLabel[item.status] || item.status}</span>
        </div>
        <div class="actions">
          ${
            item.status === "pending_review"
              ? `<button class="secondary-button" onclick="updateStatus('${item.requestId}', 'pending_approval')" type="button">ผ่านตรวจสอบ</button>`
              : ""
          }
          <button class="primary-button" onclick="updateStatus('${item.requestId}', 'approved')" type="button">อนุมัติ</button>
          <button class="secondary-button" onclick="updateStatus('${item.requestId}', 'rejected')" type="button">ไม่อนุมัติ</button>
        </div>
      </article>
    `,
    )
    .join("");
}

function renderRequestItem(item) {
  return `
    <article class="request-item">
      <strong>${escapeHtml(item.title)}</strong>
      <div class="request-meta">
        <span>${escapeHtml(item.requestId)}</span>
        <span>${requestTypeLabel[item.requestType] || item.requestType}</span>
        <span>${formatMoney(item.budget)}</span>
        <span>${statusLabel[item.status] || item.status}</span>
      </div>
    </article>
  `;
}

function showView(view) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((item) => item.classList.remove("active-view"));
  document.getElementById(`${camelViewId(view)}View`).classList.add("active-view");
  document.getElementById("viewTitle").textContent = viewTitle[view] || "ระบบ";
}

function setRequestTypeVisibility(type) {
  document.querySelectorAll(".purchase-only, .hire-only, .travel-only").forEach((element) => {
    const visible = element.classList.contains(`${type}-only`);
    element.classList.toggle("hidden", !visible);
  });
}

async function api(action, payload = {}, requireAuth = true) {
  if (!config.APPS_SCRIPT_URL || config.APPS_SCRIPT_URL.startsWith("YOUR_")) {
    throw new Error("ยังไม่ได้ตั้งค่า APPS_SCRIPT_URL ใน config.js");
  }

  const response = await fetch(config.APPS_SCRIPT_URL, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action,
      idToken: requireAuth ? state.idToken : "",
      ...payload,
    }),
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.error || "API error");
  }
  return result;
}

function fillSelect(id, values = []) {
  const select = document.getElementById(id);
  select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
}

function waitForGoogleIdentity() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (window.google?.accounts?.id) {
        window.clearInterval(timer);
        resolve();
      }
      if (attempts > 40) {
        window.clearInterval(timer);
        reject(new Error("Google Identity Services timeout"));
      }
    }, 150);
  });
}

function decodeJwt(token) {
  const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(decodeURIComponent(escape(atob(payload))));
}

function signOut() {
  state.idToken = "";
  state.user = null;
  state.requests = [];
  window.google?.accounts.id.disableAutoSelect();
  document.getElementById("loginBox").classList.remove("hidden");
  document.getElementById("profileBox").classList.add("hidden");
  renderDashboard();
  renderRequestsTable();
  renderAdminQueue();
}

function camelViewId(view) {
  return view.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function roleLabel(role) {
  return {
    admin: "ผู้ดูแลระบบ",
    reviewer: "เจ้าหน้าที่ตรวจสอบ",
    approver: "ผู้อนุมัติ",
    requester: "ผู้ขออนุมัติ",
  }[role] || "ผู้ใช้งาน";
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("th-TH", {
    style: "currency",
    currency: "THB",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.classList.remove("hidden");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.add("hidden"), 3600);
}
