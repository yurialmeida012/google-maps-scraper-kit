/**
 * VALE LEADS TV - FRONTEND APPLICATION
 * Interactive Map & Lead Management Engine
 */

// Application State
const state = {
  map: null,
  markersGroup: null,
  markersMap: new Map(), // leadIndex -> L.Marker
  allLeads: [],
  filteredLeads: [],
  cities: [],
  niches: [],
  currentFile: "",
  tileLayers: {},
  activeTileLayer: null
};

// Tile Layers Providers (No API Keys required, 100% free and reliable)
const TILE_PROVIDERS = {
  dark: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    options: {
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      maxZoom: 16
    }
  },
  streets: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 18
    }
  }
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  setupEventListeners();
  await loadConfig();
  await checkEngineStatus();
  await loadFileList();

  // Periodic health check
  setInterval(checkEngineStatus, 15000);
});

/**
 * Initialize Leaflet Map
 */
function initMap() {
  // Center at São José dos Campos by default
  state.map = L.map('map', {
    center: [-23.1896, -45.8841],
    zoom: 13,
    zoomControl: false
  });

  // Add zoom control at bottom right
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);

  // Initialize Tile Layers
  Object.keys(TILE_PROVIDERS).forEach(key => {
    state.tileLayers[key] = L.tileLayer(TILE_PROVIDERS[key].url, TILE_PROVIDERS[key].options);
  });

  // Default to Streets layer (100% free, no watermarks, full detail)
  state.activeTileLayer = state.tileLayers.streets;
  state.activeTileLayer.addTo(state.map);

  // Markers cluster group
  state.markersGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 40,
    spiderfyOnMaxZoom: true
  });
  state.map.addLayer(state.markersGroup);
}

/**
 * Setup UI Event Listeners
 */
function setupEventListeners() {
  // Map Layer Switcher
  const mapStyleSelect = document.getElementById('mapStyleSelect');
  mapStyleSelect.value = 'streets';
  mapStyleSelect.addEventListener('change', (e) => {
    const style = e.target.value;
    if (state.tileLayers[style]) {
      state.map.removeLayer(state.activeTileLayer);
      state.activeTileLayer = state.tileLayers[style];
      state.activeTileLayer.addTo(state.map);
    }
  });

  // Recenter Map
  document.getElementById('btnRecenter').addEventListener('click', () => {
    recenterMapOnLeads();
  });

  // File Select Change
  document.getElementById('fileSelect').addEventListener('change', (e) => {
    state.currentFile = e.target.value;
    loadLeads(state.currentFile);
  });

  // Refresh Button
  document.getElementById('btnRefresh').addEventListener('click', async () => {
    await checkEngineStatus();
    await loadFileList();
    if (state.currentFile) {
      await loadLeads(state.currentFile);
    }
  });

  // Search & Filter Inputs
  const searchInput = document.getElementById('searchInput');
  const btnClearSearch = document.getElementById('btnClearSearch');

  searchInput.addEventListener('input', () => {
    btnClearSearch.style.display = searchInput.value ? 'block' : 'none';
    applyFilters();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    btnClearSearch.style.display = 'none';
    applyFilters();
  });

  document.getElementById('categoryFilter').addEventListener('change', applyFilters);
  document.getElementById('ratingFilter').addEventListener('change', applyFilters);
  document.getElementById('toggleOnlyWa').addEventListener('change', applyFilters);
  document.getElementById('toggleOnlyEmail').addEventListener('change', applyFilters);

  // Export CSV
  document.getElementById('btnExportCsv').addEventListener('click', exportFilteredCsv);

  // Modal Handlers
  const modal = document.getElementById('scrapeModal');
  document.getElementById('btnNewScrape').addEventListener('click', () => {
    modal.classList.add('active');
  });

  document.getElementById('btnCloseModal').addEventListener('click', () => {
    modal.classList.remove('active');
  });

  document.getElementById('btnCancelModal').addEventListener('click', () => {
    modal.classList.remove('active');
  });

  // Niche change (detect custom free query)
  const scrapeNiche = document.getElementById('scrapeNiche');
  scrapeNiche.addEventListener('change', (e) => {
    const isCustom = e.target.value === 'custom';
    document.getElementById('customQueryGroup').style.display = isCustom ? 'block' : 'none';
  });

  // Start Scrape Button in Modal
  document.getElementById('btnStartScrape').addEventListener('click', startScrapeJob);
}

/**
 * Check Scraper Engine Status
 */
async function checkEngineStatus() {
  const badge = document.getElementById('engineStatusBadge');
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.engine_online) {
      badge.className = 'engine-badge online';
      badge.querySelector('.status-text').textContent = 'Motor Scraper Online';
    } else {
      badge.className = 'engine-badge offline';
      badge.querySelector('.status-text').textContent = 'Motor Scraper Offline';
      badge.title = 'Motor local (http://localhost:8080) não respondendo. Abra o Docker ou inicie o executável.';
    }
  } catch (err) {
    badge.className = 'engine-badge offline';
    badge.querySelector('.status-text').textContent = 'Servidor Offline';
  }
}

/**
 * Load System Config (Cities & Niches)
 */
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    state.cities = data.cities || [];
    state.niches = data.niches || [];
    state.googleKey = data.google_maps_api_key || "AIzaSyCwx0VhKVcVAcgvY0yuXBCJuRAWbAVnGrE";

    if (state.googleKey) {
      setupGoogleLayers(state.googleKey);
    }

    // Populate Modal City Select
    const citySelect = document.getElementById('scrapeCity');
    citySelect.innerHTML = state.cities.map(c => 
      `<option value="${c.id}">${c.nome} (${c.polo.split('(')[0].trim()})</option>`
    ).join('');

    // Populate Modal Niche Select
    const nicheSelect = document.getElementById('scrapeNiche');
    const nicheOptions = state.niches.map(n => 
      `<option value="${n.id}">${n.nome}</option>`
    );
    nicheOptions.push('<option value="custom">✏️ Outro (digitar termo livremente)...</option>');
    nicheSelect.innerHTML = nicheOptions.join('');
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

/**
 * Setup Google Maps Official Layers
 */
function setupGoogleLayers(key) {
  state.tileLayers.google_streets = L.tileLayer(
    `https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=${key}`,
    { attribution: '&copy; Google Maps', maxZoom: 20 }
  );
  state.tileLayers.google_hybrid = L.tileLayer(
    `https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&key=${key}`,
    { attribution: '&copy; Google Maps Satélite', maxZoom: 20 }
  );
  state.tileLayers.google_terrain = L.tileLayer(
    `https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}&key=${key}`,
    { attribution: '&copy; Google Maps Relevo', maxZoom: 20 }
  );

  // Switch default layer to Google Maps Streets
  if (state.activeTileLayer) {
    state.map.removeLayer(state.activeTileLayer);
  }
  state.activeTileLayer = state.tileLayers.google_streets;
  state.activeTileLayer.addTo(state.map);

  const mapStyleSelect = document.getElementById('mapStyleSelect');
  if (mapStyleSelect) {
    mapStyleSelect.value = 'google_streets';
  }
}

/**
 * Load List of CSV Files
 */
async function loadFileList() {
  try {
    const res = await fetch('/api/files');
    const data = await res.json();
    const select = document.getElementById('fileSelect');

    if (!data.files || data.files.length === 0) {
      select.innerHTML = '<option value="">Nenhuma base encontrada</option>';
      return;
    }

    select.innerHTML = data.files.map(f => 
      `<option value="${f.filename}">${f.label} (${f.count} leads)</option>`
    ).join('');

    // Pick first file
    state.currentFile = data.files[0].filename;
    select.value = state.currentFile;
    await loadLeads(state.currentFile);
  } catch (err) {
    console.error('Erro ao listar arquivos:', err);
  }
}

/**
 * Load Leads from Selected File
 */
async function loadLeads(filename) {
  if (!filename) return;

  const leadsList = document.getElementById('leadsList');
  leadsList.innerHTML = `
    <div class="empty-state">
      <p>Carregando leads da base...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/leads?file=${encodeURIComponent(filename)}`);
    const data = await res.json();
    state.allLeads = data.leads || [];

    // Populate Category Filter
    populateCategoryFilter();

    // Apply filters and render
    applyFilters();
  } catch (err) {
    console.error('Erro ao carregar leads:', err);
    leadsList.innerHTML = `
      <div class="empty-state">
        <p>⚠️ Erro ao carregar arquivo de leads.</p>
      </div>
    `;
  }
}

/**
 * Populate Category Filter dropdown with unique categories from current leads
 */
function populateCategoryFilter() {
  const catSelect = document.getElementById('categoryFilter');
  const categories = [...new Set(state.allLeads.map(l => l.category).filter(Boolean))].sort();

  catSelect.innerHTML = '<option value="">Todas as Categorias</option>' + 
    categories.map(c => `<option value="${c}">${c}</option>`).join('');
}

/**
 * Filter Leads based on Search, Category, Rating, Toggles
 */
function applyFilters() {
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const selectedCategory = document.getElementById('categoryFilter').value;
  const minRating = parseFloat(document.getElementById('ratingFilter').value) || 0;
  const onlyWa = document.getElementById('toggleOnlyWa').checked;
  const onlyEmail = document.getElementById('toggleOnlyEmail').checked;

  state.filteredLeads = state.allLeads.filter(lead => {
    // Search query match
    if (query) {
      const matchTitle = (lead.title || "").toLowerCase().includes(query);
      const matchAddress = (lead.address || "").toLowerCase().includes(query);
      const matchCategory = (lead.category || "").toLowerCase().includes(query);
      const matchPhone = (lead.phone || "").toLowerCase().includes(query);
      if (!matchTitle && !matchAddress && !matchCategory && !matchPhone) {
        return false;
      }
    }

    // Category match
    if (selectedCategory && lead.category !== selectedCategory) {
      return false;
    }

    // Rating match
    const rating = parseFloat(lead.review_rating) || 0;
    if (minRating > 0 && rating < minRating) {
      return false;
    }

    // WhatsApp toggle
    if (onlyWa && !lead.whatsapp) {
      return false;
    }

    // Email toggle
    if (onlyEmail && !lead.emails) {
      return false;
    }

    return true;
  });

  // Sort by rating desc
  state.filteredLeads.sort((a, b) => (parseFloat(b.review_rating) || 0) - (parseFloat(a.review_rating) || 0));

  updateMetrics();
  renderLeadsList();
  renderMapMarkers();
}

/**
 * Update Metric Cards
 */
function updateMetrics() {
  const leads = state.filteredLeads;
  const total = leads.length;
  const withWa = leads.filter(l => l.whatsapp).length;
  const withEmail = leads.filter(l => l.emails).length;
  
  let sumRating = 0;
  let countRating = 0;
  let sumReviews = 0;

  leads.forEach(l => {
    const r = parseFloat(l.review_rating);
    if (!isNaN(r) && r > 0) {
      sumRating += r;
      countRating++;
    }
    const rev = parseInt(l.review_count);
    if (!isNaN(rev)) {
      sumReviews += rev;
    }
  });

  const avgRating = countRating > 0 ? (sumRating / countRating).toFixed(1) : '0.0';

  document.getElementById('statTotalLeads').textContent = total;
  document.getElementById('statWhatsApp').textContent = `${withWa} (${total ? Math.round(withWa * 100 / total) : 0}%)`;
  document.getElementById('statEmail').textContent = `${withEmail} (${total ? Math.round(withEmail * 100 / total) : 0}%)`;
  document.getElementById('statAvgRating').textContent = avgRating;
  document.getElementById('statTotalReviews').textContent = sumReviews.toLocaleString('pt-BR');

  document.getElementById('visibleCount').textContent = total;
  document.getElementById('totalFilterCount').textContent = state.allLeads.length;
}

/**
 * Render Leads List in Sidebar
 */
function renderLeadsList() {
  const container = document.getElementById('leadsList');
  
  if (state.filteredLeads.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Nenhum prospect encontrado para os filtros selecionados.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.filteredLeads.map((lead, idx) => {
    const rating = parseFloat(lead.review_rating) || 0;
    const reviewCount = lead.review_count || 0;
    const waUrl = lead.whatsapp || (lead.phone ? `https://wa.me/55${lead.phone.replace(/\\D/g, '')}` : '');

    return `
      <div class="lead-card" id="lead-card-${idx}" onclick="selectLead(${idx})">
        <div class="lead-card-header">
          <h4 class="lead-title">${escapeHtml(lead.title)}</h4>
          ${rating > 0 ? `
            <div class="lead-rating-badge">
              ⭐ ${rating.toFixed(1)} <small>(${reviewCount})</small>
            </div>
          ` : ''}
        </div>

        ${lead.category ? `<span class="lead-category-tag">${escapeHtml(lead.category)}</span>` : ''}

        <p class="lead-address">${escapeHtml(lead.address || 'Endereço não informado')}</p>

        <div class="lead-card-footer">
          <span class="lead-phone">${escapeHtml(lead.phone || 'Sem telefone')}</span>
          <div class="lead-actions-row">
            ${waUrl ? `
              <a href="${waUrl}" target="_blank" class="btn-wa-direct" onclick="event.stopPropagation()">
                💬 WhatsApp
              </a>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render Map Markers
 */
function renderMapMarkers() {
  state.markersGroup.clearLayers();
  state.markersMap.clear();

  const bounds = [];

  state.filteredLeads.forEach((lead, idx) => {
    const lat = parseFloat(lead.latitude);
    const lon = parseFloat(lead.longitude);

    if (isNaN(lat) || isNaN(lon)) return;

    bounds.push([lat, lon]);

    const rating = parseFloat(lead.review_rating) || 0;
    const isTopRated = rating >= 4.7;

    // Create custom pin icon
    const icon = L.divIcon({
      className: 'custom-pin-wrapper',
      html: `
        <div class="custom-pin ${isTopRated ? 'top-rated' : ''}" title="${escapeHtml(lead.title)}">
          ${rating > 0 ? rating.toFixed(1) : '📍'}
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18]
    });

    const marker = L.marker([lat, lon], { icon: icon });

    // Popup Content
    const waUrl = lead.whatsapp || (lead.phone ? `https://wa.me/55${lead.phone.replace(/\\D/g, '')}` : '');
    const popupHtml = `
      <div class="popup-container">
        <span class="popup-category">${escapeHtml(lead.category || 'Empresa')}</span>
        <h4 class="popup-title">${escapeHtml(lead.title)}</h4>
        
        <div class="popup-stats-row">
          ${rating > 0 ? `<span class="popup-rating">⭐ ${rating.toFixed(1)} (${lead.review_count || 0} avaliações)</span>` : ''}
        </div>

        <p class="popup-address">${escapeHtml(lead.address || '')}</p>

        <div class="popup-contacts">
          ${lead.phone ? `<div>📞 <b>Telefone:</b> ${escapeHtml(lead.phone)}</div>` : ''}
          ${lead.emails ? `<div>✉️ <b>E-mail:</b> ${escapeHtml(lead.emails)}</div>` : ''}
          ${lead.website ? `<div>🌐 <a href="${lead.website}" target="_blank" style="color: #38bdf8;">Abrir Website</a></div>` : ''}
        </div>

        ${waUrl ? `
          <a href="${waUrl}" target="_blank" class="popup-wa-btn">
            💬 Iniciar Conversa no WhatsApp
          </a>
        ` : ''}
      </div>
    `;

    marker.bindPopup(popupHtml);

    // Marker click event
    marker.on('click', () => {
      highlightLeadCard(idx);
    });

    state.markersGroup.addLayer(marker);
    state.markersMap.set(idx, marker);
  });

  // Fit bounds if markers exist
  if (bounds.length > 0) {
    state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }
}

/**
 * Focus and Select Lead from Sidebar
 */
window.selectLead = function(idx) {
  const lead = state.filteredLeads[idx];
  if (!lead) return;

  highlightLeadCard(idx);

  const marker = state.markersMap.get(idx);
  if (marker) {
    if (state.markersGroup && state.markersGroup.hasLayer(marker)) {
      state.markersGroup.zoomToShowLayer(marker, () => {
        marker.openPopup();
      });
    } else {
      state.map.setView(marker.getLatLng(), 16, { animate: true });
      marker.openPopup();
    }
  }
};

/**
 * Highlight Lead Card in list
 */
function highlightLeadCard(idx) {
  document.querySelectorAll('.lead-card').forEach(c => c.classList.remove('active'));
  const card = document.getElementById(`lead-card-${idx}`);
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * Recenter Map on all current markers
 */
function recenterMapOnLeads() {
  const bounds = [];
  state.filteredLeads.forEach(lead => {
    const lat = parseFloat(lead.latitude);
    const lon = parseFloat(lead.longitude);
    if (!isNaN(lat) && !isNaN(lon)) bounds.push([lat, lon]);
  });

  if (bounds.length > 0) {
    state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }
}

/**
 * Export filtered leads to CSV
 */
function exportFilteredCsv() {
  if (state.filteredLeads.length === 0) {
    alert('Nenhum lead para exportar.');
    return;
  }

  const keys = ["title", "phone", "whatsapp", "emails", "website", "category", "address", "review_rating", "review_count", "latitude", "longitude"];
  const rows = [keys.join(",")];

  state.filteredLeads.forEach(lead => {
    const row = keys.map(k => {
      let val = (lead[k] || "").toString().replace(/"/g, '""');
      return `"${val}"`;
    });
    rows.push(row.join(","));
  });

  const csvContent = "\uFEFF" + rows.join("\r\n"); // UTF-8 BOM for Excel
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leads_export_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Trigger Scrape Job from Modal
 */
async function startScrapeJob() {
  const city = document.getElementById('scrapeCity').value;
  const niche = document.getElementById('scrapeNiche').value;
  const customQuery = document.getElementById('scrapeCustomQuery').value.trim();
  const depth = document.getElementById('scrapeDepth').value;
  const socials = document.getElementById('scrapeSocials').checked;

  const logBox = document.getElementById('executionLogBox');
  const logContent = document.getElementById('logContent');
  const logStatus = document.getElementById('logStatusText');
  const btnStart = document.getElementById('btnStartScrape');

  logBox.style.display = 'block';
  logContent.textContent = '🚀 Disparando tarefa de prospecção comercial...\n';
  logStatus.textContent = 'Executando...';
  btnStart.disabled = true;

  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        city: city,
        niche: niche,
        customQuery: customQuery,
        depth: depth,
        socials: socials
      })
    });

    const data = await res.json();
    if (data.ok) {
      logContent.textContent += `✅ Raspagem concluída!\nArquivo gerado: ${data.filename}\nTotal de leads: ${data.count}\n`;
      logStatus.textContent = 'Concluído com sucesso!';
      
      // Reload file list and select the new file
      await loadFileList();
      const select = document.getElementById('fileSelect');
      select.value = data.filename;
      await loadLeads(data.filename);

      setTimeout(() => {
        document.getElementById('scrapeModal').classList.remove('active');
        btnStart.disabled = false;
        logBox.style.display = 'none';
      }, 2500);
    } else {
      logContent.textContent += `\n⚠️ Aviso: ${data.message || 'Erro durante a coleta'}\n`;
      logStatus.textContent = 'Falha';
      btnStart.disabled = false;
    }
  } catch (err) {
    logContent.textContent += `\n❌ Erro de comunicação: ${err.message}\n`;
    logStatus.textContent = 'Erro';
    btnStart.disabled = false;
  }
}

/**
 * Helper to escape HTML tags
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
