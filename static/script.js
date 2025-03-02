function fetchData(url) {
    return $.ajax({
        url: url,
        method: 'GET',
        dataType: 'json'
    }).fail(function(jqXHR, textStatus, errorThrown) {
        console.error("Error fetching data from", url, textStatus, errorThrown);
    });
}

function updateCpuStats(data) {
    if (!data) return;
    $("#cpu-total").text(`${data.cpu_load_average}%`);
    $("#cpu-name").text(`${data.cpu_product_name}`);
    const $coresContainer = $("#cpu-cores");
    $coresContainer.empty(); // Clear previous data
    data.cpu_usage.forEach((usage, index) => {
        const coreDiv = `
                <div class="stat-item">
                    <span class="stat-label">Core ${index}:</span>
                    <span class="stat-value">${usage.toFixed(2)}%</span>
                </div>`;
        $coresContainer.append(coreDiv);
    });
}

function updateMemoryStats(data) {
    if (!data) return;
    $("#memory-total").text(`${(data.total_memory / 1_024_000).toFixed(2)} GiB`);
    $("#memory-used").text(`${(data.used_memory / 1_024_000).toFixed(2)} GiB`);
    $("#memory-free").text(`${(data.free_memory / 1_024_000).toFixed(2)} GiB`);
    $("#memory-available").text(`${(data.available_memory / 1_024_000).toFixed(2)} GiB`);
    $("#memory-swap-total").text(`${(data.total_swap / 1_024_000).toFixed(2)} GiB`);
    $("#memory-swap-used").text(`${(data.used_swap / 1_024_000).toFixed(2)} GiB`);
    $("#memory-swap-free").text(`${(data.free_swap / 1_024_000).toFixed(2)} GiB`);
    $("#memory-percent").text(`${(data.used_memory / data.total_memory * 100).toFixed(2)}%`);
}

function updateSystemStats(data) {
    if (!data) return;
    $("#sys-name").text(data.name || "Unknown");
    $("#sys-kernel").text(data.kernel_version || "Unknown");
    $("#sys-os").text(data.os_version || "Unknown");
    $("#sys-host").text(data.host_name || "Unknown");
    $("#sys-long-os").text(data.long_os_version || "Unknown");
    $("#sys-dist").text(data.distribution_id || "Unknown");
    $("#sys-uptime").text(data.uptime || "Unknown");
}

function updateNetworkStats(data) {
    if (!data) return;
    const $networksContainer = $("#network-stats");
    $networksContainer.empty(); // Clear previous data
    data.networks.forEach((network) => {
        const networkDiv = `
                <div class="stat-item">
                    <span class="stat-label">${network.interface_name}:</span>
                    <span class="stat-value">
                        Received: ${(network.received / 1_000).toFixed(2)} KB,
                        Transmitted: ${(network.transmitted / 1_000).toFixed(2)} KB
                    </span>
                </div>`;
        $networksContainer.append(networkDiv);
    });
}

function updateGpuStats(data){
    if (!data) return;
    const gpus = data.gpus;
    const $gpusContainer = $("#gpu-stats");
    $gpusContainer.empty();
    gpus.forEach((gpu) => {
        const gpuDiv = `
                    <div class="stat-item">
                        ${gpu.name} ${(gpu.memory / 1_024_000 ).toFixed(0)} GiB ${gpu.temperature} ºC
                    </div>
        `;
        $gpusContainer.append(gpuDiv)
    })
}

function refreshData() {
    fetchData('/cpu').done(updateCpuStats);
    fetchData('/mem').done(updateMemoryStats);
    fetchData('/system').done(updateSystemStats);
    fetchData('/networks').done(updateNetworkStats);
    fetchData('/proc').done(updateProcStats);
    fetchData('/gpu').done(updateGpuStats);
}
let currentSortColumn = null;
let currentSortOrder = "asc"; // "asc" for ascending, "desc" for descending

function updateProcStats(processes) {
    processes = processes.processes;
    if (!processes || !Array.isArray(processes)) return;

    // Apply sorting if a column is selected
    if (currentSortColumn) {
        processes = sortProcesses(processes, currentSortColumn, currentSortOrder);
    }

    const $tableBody = $("#process-table tbody");
    $tableBody.empty(); // Clear existing rows

    processes.forEach((process) => {
        const rowHtml = `
            <tr>
                <td>${process.pid}</td>
                <td>${process.name}</td>
                <td>${(process.cpu_usage * 100).toFixed(2)}</td>
                <td>${(process.memory / 1_024_000).toFixed(2)}</td>
                <td>${process.status}</td>
                <td>${process.run_time}</td>
            </tr>
        `;
        $tableBody.append(rowHtml);
    });
}

function sortProcesses(processes, column, order = "asc") {
    return processes.sort((a, b) => {
        const valueA = a[column];
        const valueB = b[column];

        if (typeof valueA === "string") {
            return order === "asc"
                ? valueA.localeCompare(valueB)
                : valueB.localeCompare(valueA);
        } else {
            return order === "asc" ? valueA - valueB : valueB - valueA;
        }
    });
}

function attachSortingHandler() {
    $("#process-table thead th[data-sortable='true']").on("click", function () {
        const column = $(this).data("column");
        const columnIndex = $(this).index();
        const newSortOrder = currentSortColumn === column && currentSortOrder === "asc" ? "desc" : "asc";

        currentSortColumn = column;
        currentSortOrder = newSortOrder;

        const $rows = $("#process-table tbody tr").toArray();
        const isNumeric = $(this).data("type") === "numeric";

        $rows.sort((a, b) => {
            const valueA = $(a).find(`td:eq(${columnIndex})`).text().trim();
            const valueB = $(b).find(`td:eq(${columnIndex})`).text().trim();

            const parsedA = isNumeric ? parseFloat(valueA) || 0 : valueA;
            const parsedB = isNumeric ? parseFloat(valueB) || 0 : valueB;

            if (typeof parsedA === "string") {
                return currentSortOrder === "asc"
                    ? parsedA.localeCompare(parsedB)
                    : parsedB.localeCompare(parsedA);
            } else {
                return currentSortOrder === "asc" ? parsedA - parsedB : parsedB - parsedA;
            }
        });

        $("#process-table tbody").empty().append($rows);
    });
}

function formatBytes(bytes) {
    if (bytes >= 1073741824) { // 1 GB = 1073741824 bytes
        return (bytes / 1073741824).toFixed(0) + "GB";
    } else if (bytes >= 1048576) { // 1 MB = 1048576 bytes
        return (bytes / 1048576).toFixed(0) + "MB";
    } else if (bytes >= 1024) { // 1 KB = 1024 bytes
        return (bytes / 1024).toFixed(0) + "KB";
    } else {
        return bytes + "B";
    }
}


$(document).ready(() => {
    setInterval(refreshData, 1000);
    refreshData();
    attachSortingHandler();
})
