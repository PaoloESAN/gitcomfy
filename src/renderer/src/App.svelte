<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  // Runes for reactive state
  let repoPath = $state<string>('')
  let isRepo = $state<boolean>(false)
  let hasUncommitted = $state<boolean>(false)
  let currentBranch = $state<string>('')
  let commits = $state<any[]>([])
  let searchQuery = $state<string>('')
  
  // Selection & modifications
  let selectedHashes = $state<Set<string>>(new Set())
  let newName = $state<string>('')
  let newEmail = $state<string>('')
  
  // Staging changes: { hash: { authorName, authorEmail } }
  let pendingUpdates = $state<Record<string, { authorName: string, authorEmail: string }>>({})
  
  // Process states
  let isProcessing = $state<boolean>(false)
  let logs = $state<string[]>([])
  let errorMsg = $state<string>('')
  let successMsg = $state<string>('')
  let activeTab = $state<'all' | 'pending'>('all')

  let filteredCommits = $derived(
    commits.filter(c => {
      const query = searchQuery.toLowerCase()
      const matchSearch = c.message.toLowerCase().includes(query) || 
                          c.authorName.toLowerCase().includes(query) || 
                          c.authorEmail.toLowerCase().includes(query) ||
                          c.hash.toLowerCase().includes(query)
      
      if (activeTab === 'pending') {
        return matchSearch && pendingUpdates[c.hash] !== undefined
      }
      return matchSearch
    })
  )

  let totalSelected = $derived(selectedHashes.size)
  let totalPending = $derived(Object.keys(pendingUpdates).length)

  // Subscriptions
  let unsubscribeProgress: (() => void) | null = null

  onMount(() => {
    unsubscribeProgress = window.api.onRewriteProgress((message: string) => {
      logs = [...logs, message]
      const consoleElem = document.getElementById('console-log')
      if (consoleElem) {
        setTimeout(() => {
          consoleElem.scrollTop = consoleElem.scrollHeight
        }, 30)
      }
    })
  })

  onDestroy(() => {
    if (unsubscribeProgress) unsubscribeProgress()
  })

  async function handleSelectRepo() {
    errorMsg = ''
    successMsg = ''
    try {
      const path = await window.api.selectRepository()
      if (path) {
        repoPath = path
        await checkRepoStatus()
      }
    } catch (err: any) {
      errorMsg = 'Error al abrir el selector: ' + err.message
    }
  }

  async function checkRepoStatus() {
    if (!repoPath) return
    errorMsg = ''
    try {
      const status = await window.api.getRepoStatus(repoPath)
      isRepo = status.isRepo
      hasUncommitted = status.hasUncommitted
      currentBranch = status.currentBranch
      
      if (isRepo) {
        await loadCommits()
      } else {
        commits = []
        selectedHashes = new Set()
        pendingUpdates = {}
        errorMsg = 'La carpeta seleccionada no es un repositorio de Git válido.'
      }
    } catch (err: any) {
      errorMsg = 'Error al verificar repositorio: ' + err.message
    }
  }

  async function loadCommits() {
    try {
      commits = await window.api.getCommits(repoPath)
      selectedHashes = new Set()
    } catch (err: any) {
      errorMsg = 'Error al cargar commits: ' + err.message
    }
  }

  function toggleSelect(hash: string) {
    if (selectedHashes.has(hash)) {
      selectedHashes.delete(hash)
    } else {
      selectedHashes.add(hash)
    }
    selectedHashes = new Set(selectedHashes) // trigger Svelte 5 state update
  }

  function toggleSelectAll() {
    if (selectedHashes.size === filteredCommits.length) {
      selectedHashes = new Set()
    } else {
      selectedHashes = new Set(filteredCommits.map(c => c.hash))
    }
  }

  function applyStagedChanges() {
    if (selectedHashes.size === 0) return
    if (!newName.trim() || !newEmail.trim()) {
      errorMsg = 'Ingresa un nombre y email válidos para aplicar cambios.'
      return
    }

    errorMsg = ''
    const nextUpdates = { ...pendingUpdates }
    selectedHashes.forEach(hash => {
      nextUpdates[hash] = {
        authorName: newName,
        authorEmail: newEmail
      }
    })
    
    pendingUpdates = nextUpdates
    selectedHashes = new Set() // Clear selection after apply
    successMsg = `Cambios preparados para ${Object.keys(nextUpdates).length} commits.`
    setTimeout(() => { successMsg = '' }, 3000)
  }

  function removePendingChange(hash: string) {
    const nextUpdates = { ...pendingUpdates }
    delete nextUpdates[hash]
    pendingUpdates = nextUpdates
  }

  function clearAllPending() {
    pendingUpdates = {}
    successMsg = 'Se descartaron todos los cambios preparados.'
    setTimeout(() => { successMsg = '' }, 3000)
  }

  async function runRewrite() {
    if (totalPending === 0) {
      errorMsg = 'No hay commits preparados para reescribir.'
      return
    }

    errorMsg = ''
    successMsg = ''
    isProcessing = true
    logs = []
    
    try {
      const result = await window.api.rewriteCommits(repoPath, $state.snapshot(pendingUpdates), currentBranch)
      if (result.success) {
        successMsg = '¡El historial de Git se ha reescrito exitosamente!'
        pendingUpdates = {}
        await checkRepoStatus() // Reload repo history
      } else {
        errorMsg = result.error || 'Ocurrió un error al reescribir el historial.'
      }
    } catch (err: any) {
      errorMsg = 'Error crítico: ' + err.message
    } finally {
      isProcessing = false
    }
  }

  // Format Unix timestamp to simple human-readable date
  function formatDate(timestamp: string): string {
    const date = new Date(parseInt(timestamp) * 1000)
    return date.toLocaleDateString(undefined, { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }
</script>

<div class="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
  <!-- Header Bar -->
  <header class="flex items-center justify-between px-6 py-4 bg-slate-900/85 border-b border-slate-800 backdrop-blur-md shrink-0">
    <div class="flex items-center gap-3">
      <div class="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
        <span class="text-white font-bold text-lg">G</span>
      </div>
      <div>
        <h1 class="text-md font-bold tracking-tight text-white flex items-center gap-2">
          GitComfy <span class="text-[10px] bg-indigo-500/20 text-indigo-400 font-semibold px-2 py-0.5 rounded-full border border-indigo-500/30">Editor de Commit</span>
        </h1>
        <p class="text-[11px] text-slate-400">Reescribe el autor y correo en tu historial de Git de forma rápida</p>
      </div>
    </div>
    
    <!-- Status / Info Bar -->
    <div class="flex items-center gap-4 text-xs">
      {#if repoPath}
        <button 
          onclick={checkRepoStatus}
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-850 hover:bg-slate-800 active:scale-95 transition text-slate-300 font-medium border border-slate-700/50 cursor-pointer"
        >
          <svg class="h-3.5 w-3.5 {isProcessing ? 'animate-spin' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
          Sincronizar
        </button>
      {/if}
    </div>
  </header>

  <!-- Main Dashboard Grid -->
  <main class="flex flex-1 min-h-0 w-full overflow-hidden">
    <!-- Left Panel: Selector & Actions -->
    <section class="w-80 border-r border-slate-800 bg-slate-900/30 p-5 flex flex-col gap-5 shrink-0 overflow-y-auto">
      <!-- 1. Folder Selector -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-md shadow-slate-950/20">
        <h2 class="text-xs font-semibold text-slate-200 flex items-center gap-2">
          <svg class="h-4.5 w-4.5 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          Repositorio Git
        </h2>
        
        {#if !repoPath}
          <p class="text-[11px] text-slate-400 leading-relaxed">Selecciona la carpeta local del proyecto de Git para empezar a explorar su historial.</p>
          <button 
            onclick={handleSelectRepo}
            class="w-full flex items-center justify-center gap-2 py-2 px-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-lg font-medium text-xs shadow-md shadow-indigo-600/20 hover:shadow-indigo-500/30 transition-all cursor-pointer"
          >
            Abrir Repositorio
          </button>
        {:else}
          <div class="flex flex-col gap-2">
            <div class="bg-slate-950 p-2.5 rounded-lg border border-slate-800 overflow-hidden">
              <p class="text-[11px] font-mono text-slate-300 truncate" title={repoPath}>{repoPath}</p>
            </div>
            
            {#if isRepo}
              <div class="flex items-center justify-between text-[11px] text-slate-300 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 rounded-lg">
                <span class="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15"></line>
                    <circle cx="18" cy="6" r="3"></circle>
                    <circle cx="6" cy="18" r="3"></circle>
                    <path d="M18 9a9 9 0 0 1-9 9"></path>
                  </svg>
                  {currentBranch}
                </span>
                <span class="text-slate-400">Activo</span>
              </div>
              
              {#if hasUncommitted}
                <div class="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-lg text-amber-400 text-[11px] leading-normal">
                  <svg class="h-4 w-4 shrink-0 text-amber-400 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  <div>
                    <span class="font-bold">Advertencia:</span> Tienes cambios sin confirmar. Se sugiere confirmarlos o guardarlos con git stash antes de reescribir.
                  </div>
                </div>
              {/if}
            {/if}
            
            <button 
              onclick={handleSelectRepo}
              class="w-full py-1.5 px-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-300 rounded-lg text-xs font-medium transition cursor-pointer"
            >
              Cambiar Carpeta
            </button>
          </div>
        {/if}
      </div>

      <!-- 2. Modifications Form -->
      {#if isRepo}
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-4 shadow-md shadow-slate-950/20">
          <h2 class="text-xs font-semibold text-slate-200 flex items-center gap-2">
            <svg class="h-4.5 w-4.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Editar Autor e Email
          </h2>
          
          <div class="flex flex-col gap-3">
            <div class="bg-indigo-500/5 border border-indigo-500/10 rounded-lg p-2.5 text-[10px] text-slate-400 leading-relaxed">
              Modifica los valores abajo y presiona <strong class="text-indigo-300">Preparar Cambios</strong> para asociarlos a los commits que tengas seleccionados ({totalSelected}).
            </div>

            <!-- Author Name Field -->
            <div class="flex flex-col gap-1.5">
              <label for="author-name-input" class="text-xs text-slate-400 flex items-center gap-1 font-medium">
                <svg class="h-3.5 w-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg> Nombre del Autor
              </label>
              <input 
                id="author-name-input"
                type="text" 
                placeholder="Ej. Juan Pérez" 
                bind:value={newName}
                class="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-700 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            <!-- Author Email Field -->
            <div class="flex flex-col gap-1.5">
              <label for="author-email-input" class="text-xs text-slate-400 flex items-center gap-1 font-medium">
                <svg class="h-3.5 w-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                  <polyline points="22,6 12,13 2,6"></polyline>
                </svg> Correo Electrónico
              </label>
              <input 
                id="author-email-input"
                type="email" 
                placeholder="Ej. juan@ejemplo.com" 
                bind:value={newEmail}
                class="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-700 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            <!-- Apply Button -->
            <button 
              onclick={applyStagedChanges}
              disabled={totalSelected === 0}
              class="w-full py-2 px-4 rounded-lg font-medium text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
                     {totalSelected > 0 ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20' : 'bg-slate-800 text-slate-500 border border-slate-800'}"
            >
              Preparar Cambios ({totalSelected})
            </button>
          </div>
        </div>

        <!-- 3. Staging and Execution panel -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-md shadow-slate-950/20 mt-auto">
          <div class="flex items-center justify-between">
            <h2 class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cambios Listos ({totalPending})</h2>
            {#if totalPending > 0}
              <button onclick={clearAllPending} class="text-[10px] text-rose-400 hover:underline cursor-pointer">Descartar todo</button>
            {/if}
          </div>

          {#if totalPending === 0}
            <p class="text-[11px] text-slate-500 italic py-2 text-center">No hay commits preparados para reescribir.</p>
          {:else}
            <div class="flex flex-col gap-2 max-h-36 overflow-y-auto pr-1">
              {#each Object.entries(pendingUpdates) as [hash, update]}
                <div class="flex items-center justify-between bg-slate-950 border border-slate-800 p-2 rounded-lg text-[11px]">
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span class="font-mono text-indigo-400 font-bold">{hash.substring(0, 7)}</span>
                      <span class="text-slate-300 font-medium truncate max-w-28">{update.authorName}</span>
                    </div>
                    <span class="text-slate-500 truncate block max-w-44">{update.authorEmail}</span>
                  </div>
                  <button 
                    onclick={() => removePendingChange(hash)}
                    class="p-1 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 rounded transition cursor-pointer"
                    title="Eliminar de los preparados"
                  >
                    <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      <line x1="10" y1="11" x2="10" y2="17"></line>
                      <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                  </button>
                </div>
              {/each}
            </div>

            <!-- Run Commit Rewrite Button -->
            <button 
              onclick={runRewrite}
              disabled={isProcessing}
              class="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg font-bold text-xs shadow-md shadow-emerald-600/20 hover:shadow-emerald-500/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {#if isProcessing}
                <svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
                Reescribiendo...
              {:else}
                <svg class="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                Ejecutar Reescritura ({totalPending})
              {/if}
            </button>
          {/if}
        </div>
      {/if}
    </section>

    <!-- Right Panel: Commits List & Console -->
    <section class="flex-1 flex flex-col min-w-0 bg-slate-950">
      {#if !isRepo}
        <!-- Welcome / Empty State -->
        <div class="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-950/50">
          <div class="h-16 w-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 text-indigo-400 mb-4 animate-pulse">
            <svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"></line>
              <circle cx="18" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
          </div>
          <h2 class="text-lg font-bold text-white mb-2">Bienvenido a tu Editor de Commits de Git</h2>
          <p class="text-xs text-slate-400 max-w-sm leading-relaxed mb-6">
            Abre un repositorio local de Git para visualizar su árbol de historial, seleccionar commits específicos y cambiar sus metadatos de autoría de forma instantánea.
          </p>
          {#if errorMsg}
            <div class="bg-rose-500/10 border border-rose-500/20 px-4 py-3 rounded-xl text-rose-400 text-xs font-semibold max-w-sm">
              {errorMsg}
            </div>
          {:else}
            <button 
              onclick={handleSelectRepo}
              class="py-2.5 px-6 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl font-semibold text-xs shadow-lg shadow-indigo-600/30 hover:shadow-indigo-500/40 transition cursor-pointer"
            >
              Abrir Carpeta
            </button>
          {/if}
        </div>
      {:else}
        <!-- Commits Dashboard Layout -->
        <div class="flex-1 flex flex-col min-h-0">
          <!-- Notification / Toast Bar -->
          {#if errorMsg || successMsg}
            <div class="px-6 py-3 border-b border-slate-800 shrink-0">
              {#if errorMsg}
                <div class="bg-rose-500/10 border border-rose-500/20 px-4 py-2.5 rounded-lg text-rose-400 text-xs font-semibold flex items-center gap-2">
                  <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  <span>{errorMsg}</span>
                </div>
              {/if}
              {#if successMsg}
                <div class="bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 rounded-lg text-emerald-400 text-xs font-semibold flex items-center gap-2">
                  <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                  <span>{successMsg}</span>
                </div>
              {/if}
            </div>
          {/if}

          <!-- Toolbar (Search, filter, actions) -->
          <div class="px-6 py-4 bg-slate-900/20 border-b border-slate-800 flex items-center justify-between shrink-0 gap-4">
            <!-- Navigation tabs -->
            <div class="flex bg-slate-900 border border-slate-800 p-0.5 rounded-lg text-xs">
              <button 
                onclick={() => activeTab = 'all'}
                class="px-4 py-1.5 rounded-md font-semibold transition cursor-pointer {activeTab === 'all' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}"
              >
                Todos los Commits ({commits.length})
              </button>
              <button 
                onclick={() => activeTab = 'pending'}
                class="px-4 py-1.5 rounded-md font-semibold transition cursor-pointer {activeTab === 'pending' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}"
              >
                Cambios Preparados ({totalPending})
              </button>
            </div>

            <!-- Search -->
            <div class="relative w-72">
              <svg class="absolute left-3 top-2.5 h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input 
                type="text" 
                placeholder="Buscar por mensaje, hash o autor..."
                bind:value={searchQuery}
                class="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-700 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
          </div>

          <!-- Commit History Table -->
          <div class="flex-1 overflow-auto min-h-0 bg-slate-900/10">
            {#if filteredCommits.length === 0}
              <div class="flex flex-col items-center justify-center p-12 text-slate-500">
                <svg class="h-8 w-8 text-slate-700 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <p class="text-xs">No se encontraron commits que coincidan con la búsqueda.</p>
              </div>
            {:else}
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="bg-slate-950 border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 sticky top-0 z-10">
                    <th class="py-3 px-4 w-12 text-center">
                      <button 
                        onclick={toggleSelectAll} 
                        class="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 cursor-pointer"
                        title="Seleccionar todos"
                      >
                        {#if selectedHashes.size === filteredCommits.length && filteredCommits.length > 0}
                          <svg class="h-4.5 w-4.5 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 11 12 14 22 4"></polyline>
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                          </svg>
                        {:else}
                          <svg class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                          </svg>
                        {/if}
                      </button>
                    </th>
                    <th class="py-3 px-4 w-28">Commit</th>
                    <th class="py-3 px-4">Mensaje</th>
                    <th class="py-3 px-4 w-60">Autor Original</th>
                    <th class="py-3 px-4 w-40">Fecha</th>
                    <th class="py-3 px-4 w-52">Cambio Preparado</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-900/60 text-[11px]">
                  {#each filteredCommits as commit (commit.hash)}
                    {@const isSelected = selectedHashes.has(commit.hash)}
                    {@const update = pendingUpdates[commit.hash]}
                    <tr 
                      onclick={() => toggleSelect(commit.hash)}
                      class="hover:bg-slate-900/40 transition cursor-pointer group 
                             {isSelected ? 'bg-indigo-600/5' : ''} 
                             {update ? 'bg-amber-500/5 border-l border-l-amber-500' : ''}"
                    >
                      <!-- Checkbox Column -->
                      <td class="py-3 px-4 text-center" onclick={(e) => e.stopPropagation()}>
                        <button onclick={() => toggleSelect(commit.hash)} class="text-slate-500 group-hover:text-slate-300 transition cursor-pointer">
                          {#if isSelected}
                            <svg class="h-4.5 w-4.5 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <polyline points="9 11 12 14 22 4"></polyline>
                              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                            </svg>
                          {:else}
                            <svg class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            </svg>
                          {/if}
                        </button>
                      </td>
                      
                      <!-- Hash Column -->
                      <td class="py-3 px-4">
                        <span class="font-mono bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-indigo-400 font-bold tracking-wide select-text">
                          {commit.hash.substring(0, 7)}
                        </span>
                      </td>

                      <!-- Message Column -->
                      <td class="py-3 px-4 font-medium text-slate-200 select-text max-w-sm truncate" title={commit.message}>
                        {commit.message}
                      </td>

                      <!-- Original Author Column -->
                      <td class="py-3 px-4 select-text">
                        <div class="flex flex-col">
                          <span class="font-medium text-slate-350 truncate max-w-[220px]">{commit.authorName}</span>
                          <span class="text-[10px] text-slate-500 truncate max-w-[220px]">{commit.authorEmail}</span>
                        </div>
                      </td>

                      <!-- Date Column -->
                      <td class="py-3 px-4 text-slate-400 whitespace-nowrap">
                        {formatDate(commit.authorDate)}
                      </td>

                      <!-- Staged Modification Column -->
                      <td class="py-3 px-4">
                        {#if update}
                          <div class="flex items-center gap-1.5 text-amber-400 font-medium">
                            <svg class="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <line x1="5" y1="12" x2="19" y2="12"></line>
                              <polyline points="12 5 19 12 12 19"></polyline>
                            </svg>
                            <div class="flex flex-col min-w-0">
                              <span class="truncate max-w-44 text-[11px] font-bold">{update.authorName}</span>
                              <span class="text-[9px] text-amber-500/80 truncate max-w-44">{update.authorEmail}</span>
                            </div>
                          </div>
                        {:else}
                          <span class="text-slate-600 italic text-[10px]">Sin cambios</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Console / Logger Output -->
      <footer class="h-48 border-t border-slate-800 bg-slate-950 flex flex-col shrink-0">
        <div class="px-5 py-2 bg-slate-900/60 border-b border-slate-900 flex items-center justify-between text-xs text-slate-400">
          <span class="flex items-center gap-1.5 font-semibold">
            <svg class="h-4 w-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
            Consola de Procesos
          </span>
          {#if logs.length > 0}
            <button onclick={() => logs = []} class="text-[10px] hover:text-slate-200 transition cursor-pointer">Limpiar consola</button>
          {/if}
        </div>
        <div 
          id="console-log"
          class="flex-1 p-4 overflow-y-auto font-mono text-[11px] text-slate-350 space-y-1 bg-slate-950/80 select-text"
        >
          {#if logs.length === 0}
            <p class="text-slate-650 italic">Los logs de los procesos en ejecución aparecerán aquí...</p>
          {:else}
            {#each logs as log}
              <div class="leading-normal py-0.5 border-b border-slate-900/30">
                <span class="text-indigo-500 mr-1.5">❯</span>{log}
              </div>
            {/each}
          {/if}
        </div>
      </footer>
    </section>
  </main>
</div>
