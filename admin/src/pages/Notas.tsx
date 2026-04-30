import { FileText } from 'lucide-react'

export default function Notas() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
          <FileText size={20} className="text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-dark">Notas Emitidas</h1>
          <p className="text-sm text-muted">Histórico de NF-e/NFC-e processadas</p>
        </div>
      </div>

      <div className="rounded-2xl border border-black/[0.06] bg-white p-12">
        <div className="flex flex-col items-center gap-3 text-center text-muted">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warning-bg">
            <FileText size={28} className="text-warning" />
          </div>
          <p className="text-sm">Emissão de notas será implementada na Fase 2 do roadmap.</p>
          <p className="text-xs text-muted/70 max-w-sm">
            Este painel mostrará todas as notas emitidas pelas empresas, com filtros por status,
            período e download de XML/DANFE.
          </p>
        </div>
      </div>
    </div>
  )
}
