<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
  } from '$lib/components/ui/card'
  import { Input } from '$lib/components/ui/input'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
  } from '$lib/components/ui/table'
  import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs'

  type Commit = {
    hash: string
    tree: string
    parents: string[]
    authorName: string
    authorEmail: string
    authorDate: string
    committerName: string
    committerEmail: string
    committerDate: string
    message: string
  }

  type PendingUpdate = { authorName: string; authorEmail: string }
  type PendingUpdates = Record<string, PendingUpdate>

  let repoPath = $state('')
  let isRepo = $state(false)
  let hasUncommitted = $state(false)
  let currentBranch = $state('')
  let commits = $state<Commit[]>([])
  let searchQuery = $state('')

  let selectedHashes = new SvelteSet<string>()
  let newName = $state('')
  let newEmail = $state('')
  let pendingUpdates = $state<PendingUpdates>({})

  let isProcessing = $state(false)
  let logs = $state<string[]>([])
  let errorMsg = $state('')
  let successMsg = $state('')
  let activeTab = $state<'all' | 'pending'>('all')
  let consoleViewport = $state<HTMLElement | null>(null)

  let filteredCommits = $derived(
    commits.filter((commit) => {
      const query = searchQuery.trim().toLowerCase()
      const matchSearch =
        commit.message.toLowerCase().includes(query) ||
        commit.authorName.toLowerCase().includes(query) ||
        commit.authorEmail.toLowerCase().includes(query) ||
        commit.hash.toLowerCase().includes(query)

      if (activeTab === 'pending') {
        return matchSearch && pendingUpdates[commit.hash] !== undefined
      }

      return matchSearch
    })
  )

  let totalSelected = $derived(selectedHashes.size)
  let totalPending = $derived(Object.keys(pendingUpdates).length)

  let unsubscribeProgress: (() => void) | null = null

  function toErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
  }

  onMount(() => {
    unsubscribeProgress = window.api.onRewriteProgress((message: string) => {
      logs = [...logs, message]
      const consoleElem = consoleViewport ?? document.getElementById('console-log')

      if (consoleElem) {
        setTimeout(() => {
          consoleElem.scrollTop = consoleElem.scrollHeight
        }, 30)
      }
    })
  })

  onDestroy(() => {
    unsubscribeProgress?.()
  })

  async function handleSelectRepo(): Promise<void> {
    errorMsg = ''
    successMsg = ''

    try {
      const path = await window.api.selectRepository()
      if (!path) return

      repoPath = path
      await checkRepoStatus()
    } catch (err: unknown) {
      errorMsg = `Error al abrir el selector: ${toErrorMessage(err)}`
    }
  }

  async function checkRepoStatus(): Promise<void> {
    if (!repoPath) return

    errorMsg = ''

    try {
      const status = await window.api.getRepoStatus(repoPath)
      isRepo = status.isRepo
      hasUncommitted = status.hasUncommitted
      currentBranch = status.currentBranch

      if (!isRepo) {
        commits = []
        selectedHashes.clear()
        pendingUpdates = {}
        errorMsg = 'La carpeta seleccionada no es un repositorio Git válido.'
        return
      }

      await loadCommits()
    } catch (err: unknown) {
      errorMsg = `Error al verificar repositorio: ${toErrorMessage(err)}`
    }
  }

  async function loadCommits(): Promise<void> {
    try {
      commits = await window.api.getCommits(repoPath)
      selectedHashes.clear()
    } catch (err: unknown) {
      errorMsg = `Error al cargar commits: ${toErrorMessage(err)}`
    }
  }

  function toggleSelect(hash: string): void {
    if (selectedHashes.has(hash)) {
      selectedHashes.delete(hash)
    } else {
      selectedHashes.add(hash)
    }
  }

  function toggleSelectAll(): void {
    if (selectedHashes.size === filteredCommits.length) {
      selectedHashes.clear()
      return
    }

    selectedHashes.clear()
    filteredCommits.forEach((commit) => selectedHashes.add(commit.hash))
  }

  function applyStagedChanges(): void {
    if (selectedHashes.size === 0) return

    if (!newName.trim() || !newEmail.trim()) {
      errorMsg = 'Ingresa un nombre y un correo válidos para aplicar cambios.'
      return
    }

    errorMsg = ''

    const nextUpdates: PendingUpdates = { ...pendingUpdates }
    selectedHashes.forEach((hash) => {
      nextUpdates[hash] = {
        authorName: newName.trim(),
        authorEmail: newEmail.trim()
      }
    })

    pendingUpdates = nextUpdates
    selectedHashes.clear()

    successMsg = `Cambios preparados para ${Object.keys(nextUpdates).length} commits.`
    setTimeout(() => {
      successMsg = ''
    }, 3000)
  }

  function removePendingChange(hash: string): void {
    const nextUpdates: PendingUpdates = { ...pendingUpdates }
    delete nextUpdates[hash]
    pendingUpdates = nextUpdates
  }

  function clearAllPending(): void {
    pendingUpdates = {}
    successMsg = 'Se descartaron todos los cambios preparados.'

    setTimeout(() => {
      successMsg = ''
    }, 3000)
  }

  async function runRewrite(): Promise<void> {
    if (totalPending === 0) {
      errorMsg = 'No hay commits preparados para reescribir.'
      return
    }

    if (!repoPath || !currentBranch) {
      errorMsg = 'No se pudo determinar el repositorio o la rama actual.'
      return
    }

    errorMsg = ''
    successMsg = ''
    isProcessing = true
    logs = []

    try {
      const result = await window.api.rewriteCommits(
        repoPath,
        $state.snapshot(pendingUpdates),
        currentBranch
      )

      if (!result.success) {
        errorMsg = result.error ?? 'Ocurrió un error al reescribir el historial.'
        return
      }

      successMsg = '¡El historial de Git se reescribió correctamente!'
      pendingUpdates = {}
      await checkRepoStatus()
    } catch (err: unknown) {
      errorMsg = `Error crítico: ${toErrorMessage(err)}`
    } finally {
      isProcessing = false
    }
  }

  function formatDate(timestamp: string): string {
    const date = new Date(Number.parseInt(timestamp, 10) * 1000)
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
</script>

<div class="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
  <header class="bg-background/95 supports-backdrop-filter:bg-background/70 border-b backdrop-blur">
    <div class="flex h-16 items-center justify-between px-6">
      <div class="flex items-center gap-3">
        <div
          class="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-md"
        >
          <span class="text-sm font-bold">G</span>
        </div>
        <div class="space-y-0.5">
          <h1 class="flex items-center gap-2 text-base font-semibold tracking-tight">
            GitComfy
            <Badge variant="secondary">Historial de commits</Badge>
          </h1>
          <p class="text-muted-foreground text-xs">
            Reescribe autor y correo de commits con una interfaz segura y rápida.
          </p>
        </div>
      </div>

      {#if repoPath}
        <Button
          variant="outline"
          size="sm"
          onclick={checkRepoStatus}
          class="gap-2"
          disabled={isProcessing}
        >
          <svg
            class={`h-4 w-4 ${isProcessing ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
          Actualizar estado
        </Button>
      {/if}
    </div>
  </header>

  <main class="flex min-h-0 flex-1 overflow-hidden">
    <aside class="bg-muted/20 w-85 shrink-0 space-y-4 overflow-y-auto border-r p-4">
      <Card>
        <CardHeader class="pb-3">
          <CardTitle class="text-sm">Repositorio</CardTitle>
          <CardDescription>
            Selecciona una carpeta local para cargar su historial de commits.
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-3">
          {#if !repoPath}
            <Button class="w-full" onclick={handleSelectRepo}>Abrir repositorio</Button>
          {:else}
            <div class="bg-background rounded-md border p-2">
              <p class="truncate font-mono text-xs" title={repoPath}>{repoPath}</p>
            </div>

            {#if isRepo}
              <div
                class="bg-background flex items-center justify-between rounded-md border px-3 py-2 text-xs"
              >
                <span class="font-medium">Rama</span>
                <Badge variant="outline">{currentBranch}</Badge>
              </div>

              {#if hasUncommitted}
                <Alert>
                  <AlertTitle>Cambios sin confirmar</AlertTitle>
                  <AlertDescription>
                    Te recomendamos hacer commit o stash antes de reescribir historial.
                  </AlertDescription>
                </Alert>
              {/if}
            {/if}

            <Button variant="secondary" class="w-full" onclick={handleSelectRepo}>
              Cambiar carpeta
            </Button>
          {/if}
        </CardContent>
      </Card>

      {#if isRepo}
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-sm">Datos de reemplazo</CardTitle>
            <CardDescription>
              Estos valores se aplicarán a los commits seleccionados.
            </CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <div class="space-y-1.5">
              <label for="author-name-input" class="text-muted-foreground text-xs font-medium">
                Nombre del autor
              </label>
              <Input id="author-name-input" bind:value={newName} placeholder="Ej. Juan Pérez" />
            </div>

            <div class="space-y-1.5">
              <label for="author-email-input" class="text-muted-foreground text-xs font-medium">
                Correo electrónico
              </label>
              <Input
                id="author-email-input"
                type="email"
                bind:value={newEmail}
                placeholder="Ej. juan@ejemplo.com"
              />
            </div>

            <Button class="w-full" onclick={applyStagedChanges} disabled={totalSelected === 0}>
              Preparar cambios ({totalSelected})
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-3">
            <div class="flex items-center justify-between">
              <CardTitle class="text-sm">Cambios preparados</CardTitle>
              <Badge variant="secondary">{totalPending}</Badge>
            </div>
          </CardHeader>
          <CardContent class="space-y-3">
            {#if totalPending === 0}
              <p class="text-muted-foreground text-xs">No hay commits preparados todavía.</p>
            {:else}
              <ScrollArea class="max-h-44 pr-2">
                <div class="space-y-2">
                  {#each Object.entries(pendingUpdates) as [hash, update] (hash)}
                    <div
                      class="bg-background flex items-start justify-between gap-2 rounded-md border p-2"
                    >
                      <div class="min-w-0 text-xs">
                        <p class="text-primary font-mono font-medium">{hash.slice(0, 7)}</p>
                        <p class="truncate font-medium">{update.authorName}</p>
                        <p class="text-muted-foreground truncate">{update.authorEmail}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onclick={() => removePendingChange(hash)}
                        title="Quitar cambio"
                      >
                        <svg
                          class="h-3.5 w-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path
                            d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                          ></path>
                          <line x1="10" y1="11" x2="10" y2="17"></line>
                          <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                      </Button>
                    </div>
                  {/each}
                </div>
              </ScrollArea>

              <div class="flex gap-2">
                <Button variant="outline" class="flex-1" onclick={clearAllPending}
                  >Descartar todo</Button
                >
                <Button class="flex-1" onclick={runRewrite} disabled={isProcessing}>
                  {#if isProcessing}
                    Reescribiendo...
                  {:else}
                    Ejecutar
                  {/if}
                </Button>
              </div>
            {/if}
          </CardContent>
        </Card>
      {/if}
    </aside>

    <section class="flex min-w-0 flex-1 flex-col">
      {#if !isRepo}
        <div class="flex flex-1 items-center justify-center p-8">
          <Card class="w-full max-w-xl">
            <CardHeader>
              <CardTitle>Selecciona un repositorio para comenzar</CardTitle>
              <CardDescription>
                Carga una carpeta Git para ver commits, filtrarlos y preparar cambios de autor.
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-3">
              {#if errorMsg}
                <Alert variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{errorMsg}</AlertDescription>
                </Alert>
              {/if}
              <Button onclick={handleSelectRepo}>Abrir carpeta</Button>
            </CardContent>
          </Card>
        </div>
      {:else}
        {#if errorMsg || successMsg}
          <div class="border-b px-4 py-3">
            {#if errorMsg}
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            {/if}
            {#if successMsg}
              <Alert>
                <AlertTitle>Listo</AlertTitle>
                <AlertDescription>{successMsg}</AlertDescription>
              </Alert>
            {/if}
          </div>
        {/if}

        <div class="bg-muted/30 flex items-center justify-between gap-3 border-b px-4 py-3">
          <Tabs bind:value={activeTab}>
            <TabsList>
              <TabsTrigger value="all">Todos ({commits.length})</TabsTrigger>
              <TabsTrigger value="pending">Preparados ({totalPending})</TabsTrigger>
            </TabsList>
          </Tabs>

          <div class="w-full max-w-sm">
            <Input bind:value={searchQuery} placeholder="Buscar por hash, mensaje o autor" />
          </div>
        </div>

        <ScrollArea class="min-h-0 flex-1">
          {#if filteredCommits.length === 0}
            <div class="text-muted-foreground flex h-full items-center justify-center p-10 text-sm">
              No hay commits para mostrar con los filtros actuales.
            </div>
          {:else}
            <Table>
              <TableHeader class="bg-background sticky top-0 z-10">
                <TableRow>
                  <TableHead class="w-12 text-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onclick={toggleSelectAll}
                      title="Seleccionar todos"
                    >
                      {#if selectedHashes.size === filteredCommits.length && filteredCommits.length > 0}
                        <svg
                          class="text-primary h-4.5 w-4.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <polyline points="9 11 12 14 22 4"></polyline>
                          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
                          ></path>
                        </svg>
                      {:else}
                        <svg
                          class="h-4.5 w-4.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        </svg>
                      {/if}
                    </Button>
                  </TableHead>
                  <TableHead class="w-28">Hash</TableHead>
                  <TableHead>Mensaje</TableHead>
                  <TableHead class="w-64">Autor</TableHead>
                  <TableHead class="w-44">Fecha</TableHead>
                  <TableHead class="w-64">Cambio preparado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#each filteredCommits as commit (commit.hash)}
                  {@const isSelected = selectedHashes.has(commit.hash)}
                  {@const update = pendingUpdates[commit.hash]}
                  <TableRow
                    class={isSelected ? 'bg-primary/10' : ''}
                    onclick={() => toggleSelect(commit.hash)}
                  >
                    <TableCell class="text-center" onclick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onclick={() => toggleSelect(commit.hash)}
                      >
                        {#if isSelected}
                          <svg
                            class="text-primary h-4.5 w-4.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <polyline points="9 11 12 14 22 4"></polyline>
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
                            ></path>
                          </svg>
                        {:else}
                          <svg
                            class="h-4.5 w-4.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                          </svg>
                        {/if}
                      </Button>
                    </TableCell>

                    <TableCell>
                      <span class="bg-muted rounded px-2 py-0.5 font-mono text-xs"
                        >{commit.hash.slice(0, 7)}</span
                      >
                    </TableCell>
                    <TableCell class="max-w-sm truncate" title={commit.message}
                      >{commit.message}</TableCell
                    >
                    <TableCell>
                      <div class="min-w-0">
                        <p class="truncate font-medium">{commit.authorName}</p>
                        <p class="text-muted-foreground truncate text-xs">{commit.authorEmail}</p>
                      </div>
                    </TableCell>
                    <TableCell class="text-muted-foreground"
                      >{formatDate(commit.authorDate)}</TableCell
                    >
                    <TableCell>
                      {#if update}
                        <div class="bg-muted/40 min-w-0 rounded-md border p-2">
                          <p class="truncate font-medium">{update.authorName}</p>
                          <p class="text-muted-foreground truncate text-xs">{update.authorEmail}</p>
                        </div>
                      {:else}
                        <span class="text-muted-foreground text-xs">Sin cambios</span>
                      {/if}
                    </TableCell>
                  </TableRow>
                {/each}
              </TableBody>
            </Table>
          {/if}
        </ScrollArea>
      {/if}

      <footer class="flex h-44 shrink-0 flex-col border-t">
        <div class="bg-muted/30 flex items-center justify-between border-b px-4 py-2 text-xs">
          <span class="text-muted-foreground font-medium">Consola de proceso</span>
          {#if logs.length > 0}
            <Button variant="ghost" size="xs" onclick={() => (logs = [])}>Limpiar</Button>
          {/if}
        </div>

        <ScrollArea id="console-log" bind:viewportRef={consoleViewport} class="flex-1">
          <div class="space-y-1 p-3 font-mono text-xs">
            {#if logs.length === 0}
              <p class="text-muted-foreground">Aquí aparecerán los logs durante la reescritura.</p>
            {:else}
              {#each logs as log, idx (`${idx}-${log}`)}
                <div class="border-border/60 text-muted-foreground border-b py-0.5">
                  <span class="text-primary mr-1">❯</span>{log}
                </div>
              {/each}
            {/if}
          </div>
        </ScrollArea>
      </footer>
    </section>
  </main>
</div>
