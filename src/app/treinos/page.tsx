"use client";
import { useState, useEffect } from "react";
import { mockDb, Aluno, Treino, Exercicio, MODELOS_ESTUDIO, BaseTreino, registrarEvolucaoCargas, garantirHistoricoCargasAluno, formatNomeAluno } from "@/lib/mockData";
import { Save, Plus, Trash2, ArrowLeft, CopyCheck, Eraser, Upload, BookOpen, X, GripVertical, ChevronUp, ChevronDown, FileText, TrendingUp, Printer, Download, Award, Calendar, Dumbbell, Sparkles, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { RUMPEL_LOGO_BASE64 } from "@/lib/logoBase64";

function parseCargaNumeric(cargaStr: string | undefined): number | null {
  if (!cargaStr) return null;
  const str = cargaStr.trim();
  if (str === '-' || str === '' || str.toUpperCase() === 'P.C') return null;
  const match = str.replace(',', '.').match(/\d+(\.\d+)?/);
  if (match) {
    const val = parseFloat(match[0]);
    return isNaN(val) ? null : val;
  }
  return null;
}

type ItemProgressoCarga = {
  nomeExercicio: string;
  categoria: string;
  cargaInicial: string;
  numericInicial: number | null;
  dataInicial: string;
  faseInicial: string;
  cargaAtual: string;
  numericAtual: number | null;
  faseAtual: string;
  diffKg: number | null;
  percentualGanha: number | null;
  historicoVersoes: {
    faseLabel: string;
    data: string;
    carga: string;
    numeric: number | null;
  }[];
};

type DadosProgressoAluno = {
  dataPrimeiroTreino: string;
  totalPresencas: number;
  totalFichas: number;
  faseAtual: string;
  itens: ItemProgressoCarga[];
  destaques: ItemProgressoCarga[];
  fichasLinhaTempo: {
    id: string;
    label: string;
    fase: string;
    dataInicio: string;
    dataTermino?: string;
    isAtual: boolean;
    treinos: Treino[];
  }[];
};

const getDadosProgressoAluno = (aluno: Aluno | null): DadosProgressoAluno | null => {
  if (!aluno) return null;

  const fichasLinhaTempo: {
    id: string;
    label: string;
    fase: string;
    dataInicio: string;
    dataTermino?: string;
    isAtual: boolean;
    treinos: Treino[];
  }[] = [];

  if (aluno.versoesAnteriores && aluno.versoesAnteriores.length > 0) {
    aluno.versoesAnteriores.forEach((v, idx) => {
      fichasLinhaTempo.push({
        id: v.id || `v_${idx}`,
        label: `1ª Ficha ${idx > 0 ? `(${idx + 1}ª Versão)` : '(Inicial)'}`,
        fase: v.faseTreinamento || `Fase ${idx + 1}`,
        dataInicio: v.dataInicio || 'Data inicial',
        dataTermino: v.dataTermino || 'Concluída',
        isAtual: false,
        treinos: v.treinos || []
      });
    });
  }

  const dataAtualStr = aluno.dataFichaAtual || new Date().toLocaleDateString('pt-BR');
  fichasLinhaTempo.push({
    id: 'atual',
    label: fichasLinhaTempo.length === 0 ? 'Ficha Inicial (Atual)' : `Ficha Atual (${fichasLinhaTempo.length + 1}ª Ficha)`,
    fase: aluno.faseTreinamento || 'Fase Atual',
    dataInicio: dataAtualStr,
    dataTermino: 'Em andamento',
    isAtual: true,
    treinos: aluno.treinos || []
  });

  const dataPrimeiroTreino = fichasLinhaTempo[0]?.dataInicio || (aluno.historico && aluno.historico.length > 0 ? aluno.historico[0].data : dataAtualStr);
  const totalPresencas = aluno.historico ? aluno.historico.length : 0;
  const totalFichas = fichasLinhaTempo.length;
  const faseAtual = aluno.faseTreinamento || 'Fase Atual';

  const exerciciosMap = new Map<string, {
    nomeOriginal: string;
    categoria: string;
    pontosCarga: { faseLabel: string; data: string; carga: string; numeric: number | null }[];
  }>();

  fichasLinhaTempo.forEach((ficha) => {
    ficha.treinos.forEach((tr) => {
      tr.exercicios.forEach((ex) => {
        const nomeClean = ex.nome.trim();
        if (!nomeClean) return;
        const key = nomeClean.toUpperCase();

        if (!exerciciosMap.has(key)) {
          exerciciosMap.set(key, {
            nomeOriginal: nomeClean,
            categoria: ex.categoria || 'Geral',
            pontosCarga: []
          });
        }

        const exInfo = exerciciosMap.get(key)!;

        if (ex.historicoCargas && ex.historicoCargas.length > 0) {
          ex.historicoCargas.forEach((hc) => {
            const num = parseCargaNumeric(hc.carga);
            if (hc.carga && hc.carga !== '-') {
              const jaExiste = exInfo.pontosCarga.some(p => p.data === hc.data && p.carga === hc.carga);
              if (!jaExiste) {
                exInfo.pontosCarga.push({
                  faseLabel: ficha.label,
                  data: hc.data,
                  carga: hc.carga,
                  numeric: num
                });
              }
            }
          });
        } else {
          const cargaStr = (ex.carga || '').trim();
          const numVal = parseCargaNumeric(cargaStr);

          if (cargaStr && cargaStr !== '-') {
            const jaExiste = exInfo.pontosCarga.some(p => p.faseLabel === ficha.label && p.carga === cargaStr);
            if (!jaExiste) {
              exInfo.pontosCarga.push({
                faseLabel: ficha.label,
                data: ficha.dataInicio,
                carga: cargaStr,
                numeric: numVal
              });
            }
          }
        }
      });
    });
  });

  const itens: ItemProgressoCarga[] = [];

  exerciciosMap.forEach((info) => {
    if (info.pontosCarga.length === 0) return;

    const historicoVersoes = info.pontosCarga;
    const inicial = historicoVersoes[0];
    const atual = historicoVersoes[historicoVersoes.length - 1];

    let diffKg: number | null = null;
    let percentualGanha: number | null = null;

    if (inicial.numeric !== null && atual.numeric !== null) {
      diffKg = parseFloat((atual.numeric - inicial.numeric).toFixed(1));
      if (inicial.numeric > 0) {
        percentualGanha = parseFloat((((atual.numeric - inicial.numeric) / inicial.numeric) * 100).toFixed(1));
      }
    }

    itens.push({
      nomeExercicio: info.nomeOriginal,
      categoria: info.categoria,
      cargaInicial: inicial.carga,
      numericInicial: inicial.numeric,
      dataInicial: inicial.data,
      faseInicial: inicial.faseLabel,
      cargaAtual: atual.carga,
      numericAtual: atual.numeric,
      faseAtual: atual.faseLabel,
      diffKg,
      percentualGanha,
      historicoVersoes
    });
  });

  itens.sort((a, b) => {
    if (a.percentualGanha !== null && b.percentualGanha !== null) {
      return b.percentualGanha - a.percentualGanha;
    }
    if (a.diffKg !== null && b.diffKg !== null) {
      return b.diffKg - a.diffKg;
    }
    if (a.percentualGanha !== null) return -1;
    if (b.percentualGanha !== null) return 1;
    return a.nomeExercicio.localeCompare(b.nomeExercicio);
  });

  const destaques = itens.filter(i => (i.diffKg !== null && i.diffKg > 0) || (i.percentualGanha !== null && i.percentualGanha > 0)).slice(0, 4);

  return {
    dataPrimeiroTreino,
    totalPresencas,
    totalFichas,
    faseAtual,
    itens,
    destaques,
    fichasLinhaTempo
  };
};

const gerarPdfRelatorio = (aluno: Aluno, dados: DadosProgressoAluno) => {
  const doc = new jsPDF();
  const dataHoje = new Date().toLocaleDateString('pt-BR');

  doc.setFontSize(20);
  doc.setTextColor(30, 41, 59);
  doc.text(`Relatorio de Progresso do Aluno`, 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Estudio de Treinamento - Emissao em ${dataHoje}`, 14, 26);

  doc.setFillColor(241, 245, 249);
  doc.roundedRect(14, 32, 182, 28, 3, 3, 'F');

  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(`Aluno(a): ${aluno.nome.toUpperCase()}`, 20, 42);

  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Primeiro Treino: ${dados.dataPrimeiroTreino}   |   Presencas Concluidas: ${dados.totalPresencas} treinos`, 20, 49);
  doc.text(`Fases Percorridas: ${dados.totalFichas} ficha(s)   |   Fase Atual: ${dados.faseAtual}`, 20, 55);

  let y = 68;

  if (dados.destaques.length > 0) {
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text(`Destaques de Evolucao de Carga`, 14, y);
    y += 4;

    const bodyDestaques = dados.destaques.map(d => [
      d.nomeExercicio,
      d.cargaInicial,
      d.cargaAtual,
      d.diffKg !== null && d.diffKg > 0
        ? `+${d.diffKg} kg ${d.percentualGanha ? `(+${d.percentualGanha.toFixed(0)}%)` : ''}`
        : 'Evolucao Registrada'
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Exercicio', 'Carga Inicial', 'Carga Atual', 'Evolucao Total']],
      body: bodyDestaques,
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 9.5, cellPadding: 4 }
    });

    y = (doc as any).lastAutoTable.finalY + 10;
  }

  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text(`Historico Completo de Cargas por Exercicio`, 14, y);
  y += 4;

  const bodyGeral = dados.itens.map(d => {
    let evolucaoStr = 'Estavel';
    if (d.diffKg !== null) {
      const sinal = d.diffKg > 0 ? '+' : '';
      const pctStr = d.percentualGanha !== null ? ` (${sinal}${d.percentualGanha.toFixed(0)}%)` : '';
      evolucaoStr = `${sinal}${d.diffKg} kg${pctStr}`;
    } else if (d.cargaInicial !== d.cargaAtual) {
      evolucaoStr = `${d.cargaInicial} -> ${d.cargaAtual}`;
    }

    const historicoStr = d.historicoVersoes.map(h => `${h.faseLabel}: ${h.carga}`).join('\n');

    return [
      d.nomeExercicio,
      d.cargaInicial,
      d.cargaAtual,
      evolucaoStr,
      historicoStr
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['Exercicio', '1a Ficha', 'Carga Atual', 'Evolucao', 'Evolucao por Ficha']],
    body: bodyGeral,
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 42 },
      1: { cellWidth: 24 },
      2: { cellWidth: 24 },
      3: { cellWidth: 32 },
      4: { cellWidth: 'auto' }
    }
  });

  doc.save(`Relatorio_Progresso_${aluno.nome.replace(/\s+/g, '_')}.pdf`);
};

const getProgressoTreinos = (aluno: Aluno | null) => {
  if (!aluno) {
    return {
      semanasCompletas: 0,
      minContagem: 0,
      treinosRestantes: {} as Record<string, number>,
      totalTreinosRestantes: 0,
      contagemTreinos: {} as Record<string, number>,
      dataRefStr: "",
      treinosFaltandoDetalhado: [] as string[]
    };
  }

  const dataReferenciaStr = aluno.dataFichaAtual || (aluno.historico && aluno.historico.length > 0 ? aluno.historico[0].data : new Date().toLocaleDateString('pt-BR'));
  
  let dataRef: Date | null = null;
  if (dataReferenciaStr) {
    const refParts = dataReferenciaStr.split('/');
    if (refParts.length === 3) {
      dataRef = new Date(parseInt(refParts[2]), parseInt(refParts[1]) - 1, parseInt(refParts[0]));
    }
  }

  const contagemTreinos: Record<string, number> = {};
  if (aluno.treinos) {
    aluno.treinos.forEach(t => {
      contagemTreinos[t.nomeTreino] = 0;
    });
  }

  if (aluno.historico && dataRef) {
    aluno.historico.forEach(h => {
      const hParts = h.data.split('/');
      if (hParts.length !== 3) return;
      const hDate = new Date(parseInt(hParts[2]), parseInt(hParts[1]) - 1, parseInt(hParts[0]));
      if (hDate >= dataRef!) {
        if (contagemTreinos[h.nomeTreino] !== undefined) {
          contagemTreinos[h.nomeTreino]++;
        }
      }
    });
  }

  const contagens = Object.values(contagemTreinos);
  const minContagem = contagens.length > 0 ? Math.min(...contagens) : 0;
  const semanasCompletas = minContagem + (aluno.semanasConcluidas || 0);

  const treinosRestantes: Record<string, number> = {};
  let totalTreinosRestantes = 0;
  const treinosFaltandoDetalhado: string[] = [];

  if (aluno.treinos) {
    aluno.treinos.forEach(t => {
      const realizados = contagemTreinos[t.nomeTreino] || 0;
      const offset = aluno.semanasConcluidas || 0;
      const faltam = Math.max(0, 6 - (realizados + offset));
      treinosRestantes[t.nomeTreino] = faltam;
      totalTreinosRestantes += faltam;
      if (faltam > 0) {
        treinosFaltandoDetalhado.push(`${t.nomeTreino}: ${faltam} restante${faltam > 1 ? 's' : ''}`);
      }
    });
  }

  return {
    semanasCompletas,
    minContagem,
    treinosRestantes,
    totalTreinosRestantes,
    contagemTreinos,
    dataRefStr: dataReferenciaStr,
    treinosFaltandoDetalhado
  };
};

export default function TreinosPage() {
  const router = useRouter();
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [selectedAlunoId, setSelectedAlunoId] = useState<string>("");
  const [alunoAtual, setAlunoAtual] = useState<Aluno | null>(null);
  const [activeTab, setActiveTab] = useState<number>(0);
  const [busca, setBusca] = useState("");
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [versaoComparacaoId, setVersaoComparacaoId] = useState<string>("");
  const [draggedTab, setDraggedTab] = useState<number | null>(null);
  const [draggedEx, setDraggedEx] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [basesCustom, setBasesCustom] = useState<BaseTreino[]>([]);
  const [showBasesModal, setShowBasesModal] = useState(false);
  const [showRelatorioModal, setShowRelatorioModal] = useState(false);
  const [showNovoAlunoModal, setShowNovoAlunoModal] = useState(false);
  const [novoAlunoNome, setNovoAlunoNome] = useState("");
  const [novoAlunoIntrodutorio, setNovoAlunoIntrodutorio] = useState(false);
  const [showEditarNomeModal, setShowEditarNomeModal] = useState(false);
  const [editarNomeValue, setEditarNomeValue] = useState("");
  const [semanasInput, setSemanasInput] = useState<string>("");

  useEffect(() => {
    if (alunoAtual) {
      const prog = getProgressoTreinos(alunoAtual);
      setSemanasInput(prog.semanasCompletas.toString());
    } else {
      setSemanasInput("");
    }
  }, [alunoAtual?.id, alunoAtual?.dataFichaAtual, alunoAtual?.semanasConcluidas]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const todosAlunos = await mockDb.getAlunos();
      setAlunos(todosAlunos);
      const bases = await mockDb.getBases();
      setBasesCustom(bases);
      if(todosAlunos.length > 0) {
        selecionarAluno(todosAlunos[0].id, todosAlunos);
      }
      setLoading(false);
    })();
  }, []);

  // auto-seleciona o primeiro da lista filtrada se o atual sumir da busca
  useEffect(() => {
    const filt = alunos.filter(a => a.nome.toLowerCase().includes(busca.toLowerCase()));
    if (filt.length > 0 && !filt.some(a => a.id === selectedAlunoId)) {
        selecionarAluno(filt[0].id, alunos);
    }
  }, [busca, alunos, selectedAlunoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selecionarAluno = async (id: string, listaAlunos: Aluno[] = alunos) => {
    setSelectedAlunoId(id);
    const aluno = listaAlunos.find(a => a.id === id);
    if (aluno) {
      // Busca o aluno completo do Supabase (para obter as versoes_anteriores que foram omitidas na listagem inicial)
      try {
        const fullAluno = await mockDb.getAlunoById(id);
        const target = fullAluno || JSON.parse(JSON.stringify(aluno));
        garantirHistoricoCargasAluno(target);
        setAlunoAtual(target);
      } catch (err) {
        console.error("Erro ao buscar detalhes do aluno:", err);
        const target = JSON.parse(JSON.stringify(aluno));
        garantirHistoricoCargasAluno(target);
        setAlunoAtual(target);
      }
      setActiveTab(0);
    } else {
      setAlunoAtual(null);
    }
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    selecionarAluno(e.target.value);
  };

  const handleUpdateProtocolo = (campo: string, valor: any) => {
    if (!alunoAtual) return;
    const newAluno = { ...alunoAtual };
    const currentTreino = newAluno.treinos[activeTab];
    if (!currentTreino.protocoloBike) {
      currentTreino.protocoloBike = { ativo: false, data: '', teste: '', tempo: '', avg: '', resultados: '' };
    }
    (currentTreino.protocoloBike as any)[campo] = valor;
    setAlunoAtual(newAluno);
  };

  const saveAluno = async () => {
    if(alunoAtual) {
      garantirHistoricoCargasAluno(alunoAtual);
      await mockDb.saveAluno(alunoAtual);
      // Atualiza a lista master
      const updated = await mockDb.getAlunos();
      setAlunos(updated);
      alert("Ficha do aluno salva com sucesso!");
    }
  };

  const aplicarFichaInicial = () => {
    if(!alunoAtual) return;
    if(alunoAtual.treinos.length > 0) {
      if(!confirm("Este aluno já tem treinos. Deseja substituir tudo pela Ficha Inicial?")) {
        return;
      }
    }
    const templates = mockDb.getTemplates();
    const novosTreinos = JSON.parse(JSON.stringify(templates)).map((t: Treino, idx: number) => {
        t.id = `t${alunoAtual.id}_${Date.now()}_${idx}`;
        t.exercicios.forEach(ex => ex.id = `ex_${Date.now()}_${Math.random()}`);
        t.ordenadoManualmente = false;
        return t;
    });

    setAlunoAtual({ ...alunoAtual, treinos: novosTreinos });
    setActiveTab(0);
  };

  const getPesoCategoria = (cat: string) => {
    const upper = (cat || '').toUpperCase();
    if (upper.includes('CORE')) return 1;
    // Força e Potência agrupados com mesmo peso para permitir intercalar no modelo Complex
    // O sort estável manterá a ordem manual definida pelo usuário.
    if (upper.includes('POTENCIA') || upper.includes('POTÊNCIA') || upper.includes('FORCA') || upper.includes('FORÇA')) return 2;
    return 3;
  };

  const handleExercicioChange = (treinoIndex: number, exIndex: number, field: keyof Exercicio, value: string) => {
    if(!alunoAtual) return;
    const newAluno = { ...alunoAtual };
    const treino = newAluno.treinos[treinoIndex];

    if (treino.limitesBlocos === undefined) {
      treino.limitesBlocos = getBlockLimits(treino);
      treino.bloco2Desativado = undefined;
      treino.bloco3Desativado = undefined;
      treino.limiteBloco1 = undefined;
      treino.limiteBloco2 = undefined;
    }

    const ex = treino.exercicios[exIndex];
    if (field === 'carga') {
      registrarEvolucaoCargas(ex, value, undefined, alunoAtual.dataFichaAtual);
    } else {
      (ex as any)[field] = value;
    }
    
    setAlunoAtual(newAluno);
  };

  const adicionarExercicio = (treinoIndex: number) => {
    if(!alunoAtual) return;
    const newAluno = { ...alunoAtual };
    const newId = `ex_${Date.now()}_${Math.random()}`;
    const treino = newAluno.treinos[treinoIndex];

    if (treino.limitesBlocos === undefined) {
      treino.limitesBlocos = getBlockLimits(treino);
      treino.bloco2Desativado = undefined;
      treino.bloco3Desativado = undefined;
      treino.limiteBloco1 = undefined;
      treino.limiteBloco2 = undefined;
    }

    treino.exercicios.push({
      id: newId,
      nome: "",
      categoria: "Core",
      series: "3",
      reps: "10",
      intervalo: "",
      carga: "-"
    });
    setAlunoAtual(newAluno);
  };

  const moverExercicio = (treinoIndex: number, exIndex: number, direcao: 'up' | 'down') => {
    if (!alunoAtual) return;
    const newAluno = { ...alunoAtual };
    const treino = newAluno.treinos[treinoIndex];
    const N = treino.exercicios.length;

    if (direcao === 'up' && exIndex === 0) {
      const limits = [...getBlockLimits(treino)];
      if (limits.length > 0 && limits[0] === 0) {
        limits[0] = 1;
        treino.limitesBlocos = limits;
        setAlunoAtual(newAluno);
        return;
      }
      return;
    }
    if (direcao === 'down' && exIndex === N - 1) return;

    const targetIndex = direcao === 'up' ? exIndex - 1 : exIndex + 1;
    const limits = [...getBlockLimits(treino)];

    // Check if moving across a boundary
    if (direcao === 'up') {
      for (let k = 0; k < limits.length; k++) {
        if (limits[k] === exIndex) {
          limits[k]++;
          break;
        }
      }
    } else {
      for (let k = 0; k < limits.length; k++) {
        if (limits[k] - 1 === exIndex) {
          limits[k]--;
          break;
        }
      }
    }

    // Swap exercises
    const tempEx = treino.exercicios[exIndex];
    treino.exercicios[exIndex] = treino.exercicios[targetIndex];
    treino.exercicios[targetIndex] = tempEx;

    // Sanitize limits
    const sanitizedLimits = limits.filter((lim, idx, arr) => {
      if (lim < 0) return false;
      if (lim >= N) return false;
      if (idx > 0 && lim <= arr[idx - 1]) return false;
      return true;
    });

    treino.limitesBlocos = sanitizedLimits;
    treino.bloco2Desativado = undefined;
    treino.bloco3Desativado = undefined;
    treino.limiteBloco1 = undefined;
    treino.limiteBloco2 = undefined;
    treino.ordenadoManualmente = true;

    setAlunoAtual(newAluno);
  };

  const getBlockLimits = (treino: any): number[] => {
    if (treino.limitesBlocos !== undefined) {
      return treino.limitesBlocos;
    }
    if (treino.bloco2Desativado) {
      return [];
    }

    const getLegacyBlockLimits = (t: any): number[] => {
      if (t.bloco2Desativado) {
        return [];
      }
      const forcaIndices: number[] = [];
      t.exercicios.forEach((ex: any, idx: number) => {
        const cat = (ex.categoria || '').toUpperCase();
        if (cat.includes('FORC') || cat.includes('FORÇ')) {
          forcaIndices.push(idx + 1);
        }
      });
      if (forcaIndices.length === 0) {
        return [];
      }
      const limit1Forca = t.limiteBloco1 !== undefined ? t.limiteBloco1 : 3;
      const bloco3Desativado = t.bloco3Desativado !== false;
      const limit1Index = forcaIndices[Math.min(limit1Forca, forcaIndices.length) - 1];
      if (bloco3Desativado) {
        return [limit1Index];
      }
      const limit2Forca = t.limiteBloco2 !== undefined ? t.limiteBloco2 : (limit1Forca + 3);
      const limit2Index = forcaIndices[Math.min(limit2Forca, forcaIndices.length) - 1];
      return [limit1Index, limit2Index];
    };

    const isComplex = treino.exercicios.some((ex: any, i: number, arr: any[]) => {
      const isPot = (ex.categoria || '').toUpperCase().includes('POTENCIA') || (ex.categoria || '').toUpperCase().includes('POTÊNCIA');
      if (!isPot) return false;
      return arr.slice(0, i).some(prev => (prev.categoria || '').toUpperCase().includes('FORC') || (prev.categoria || '').toUpperCase().includes('FORÇ'));
    });

    const limits: number[] = [];
    let forcaCounter = 0;
    let complexBlockCounter = 0;
    
    treino.exercicios.forEach((ex: any, exIdx: number) => {
      const upperCat = (ex.categoria || '').toUpperCase();
      const isForca = upperCat.includes('FORC') || upperCat.includes('FORÇ');
      
      if (isForca) {
        forcaCounter++;
        if (isComplex) {
          const prevEx = exIdx > 0 ? treino.exercicios[exIdx - 1] : null;
          const prevCat = prevEx ? (prevEx.categoria || '').toUpperCase() : '';
          const prevIsForca = prevCat.includes('FORC') || prevCat.includes('FORÇ');
          
          if (forcaCounter === 1 || !prevIsForca) {
            complexBlockCounter++;
            limits.push(exIdx);
          }
        } else {
          if (forcaCounter === 1) {
            limits.push(exIdx);
          } else {
            const legacyLimits = getLegacyBlockLimits(treino);
            const matchIdx = legacyLimits.indexOf(forcaCounter - 1);
            if (matchIdx !== -1) {
              limits.push(exIdx);
            }
          }
        }
      }
    });
    return limits;
  };

  const gerarPdfTreino = (aluno: Aluno) => {
    if (!aluno) return;

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const dataHoje = new Date().toLocaleDateString('pt-BR');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Helper para renderizar o cabeçalho superior Rumpel Training com logo em cada página
    const renderPageHeader = (isFirstPage: boolean) => {
      // Faixa Superior (Verde Escuro Rumpel - #15803d)
      doc.setFillColor(21, 128, 61); // Green 700 (#15803d)
      doc.rect(0, 0, pageWidth, 22, 'F');

      // Tentar desenhar o Logo Rumpel Training no cabeçalho
      try {
        doc.addImage(RUMPEL_LOGO_BASE64, 'JPEG', 12, 2.5, 17, 17);
      } catch (e) {
        console.error("Erro ao carregar imagem no PDF:", e);
      }

      // Título e Subtítulo Rumpel Training
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.text("RUMPEL TRAINING", 33, 11);

      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(220, 252, 231); // Soft green text
      doc.text("FICHA DE TREINAMENTO INDIVIDUAL", 33, 17);

      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(220, 252, 231);
      doc.text(`Emissão: ${dataHoje}`, pageWidth - 14, 14, { align: "right" });

      if (isFirstPage) {
        // Box de Informações do Aluno para a primeira página (Fundo Verde Claro Suave #F0FDF4, Borda #BBF7D0)
        const yBox = 25;
        doc.setFillColor(240, 253, 244);
        doc.setDrawColor(187, 247, 208);
        doc.roundedRect(14, yBox, pageWidth - 28, 25, 3, 3, 'FD');

        doc.setFontSize(12);
        doc.setTextColor(22, 101, 52); // Dark Green #166534
        doc.setFont("helvetica", "bold");
        doc.text(`ALUNO(A): ${aluno.nome.toUpperCase()}`, 18, yBox + 7);

        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(55, 65, 81);
        doc.text(`Fase: ${aluno.faseTreinamento || 'Geral'}`, 18, yBox + 15);
        doc.text(`Início da Ficha: ${aluno.dataFichaAtual || dataHoje}`, 85, yBox + 15);
        if (aluno.alturaCmj) {
          doc.text(`CMJ: ${aluno.alturaCmj} cm`, 155, yBox + 15);
        }

        if (aluno.observacoes && aluno.observacoes.trim() !== '') {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(180, 83, 9);
          doc.text(`Obs/Lesões: ${aluno.observacoes}`, 18, yBox + 21);
        }
        return 54;
      } else {
        // Cabeçalho Compacto do Aluno para as páginas seguintes
        doc.setFillColor(240, 253, 244);
        doc.setDrawColor(187, 247, 208);
        doc.roundedRect(14, 24, pageWidth - 28, 10, 2, 2, 'FD');

        doc.setFontSize(9.5);
        doc.setTextColor(22, 101, 52);
        doc.setFont("helvetica", "bold");
        doc.text(`ALUNO(A): ${aluno.nome.toUpperCase()}`, 18, 30.5);

        doc.setFontSize(8.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(55, 65, 81);
        doc.text(`Fase: ${aluno.faseTreinamento || 'Geral'}`, pageWidth - 18, 30.5, { align: "right" });
        return 37;
      }
    };

    if (!aluno.treinos || aluno.treinos.length === 0) {
      const y = renderPageHeader(true);
      doc.setFontSize(11);
      doc.setTextColor(100, 116, 139);
      doc.text("Nenhum treino cadastrado nesta ficha.", 14, y + 10);
      doc.save(`Ficha_Treino_${aluno.nome.replace(/\s+/g, '_')}.pdf`);
      return;
    }

    aluno.treinos.forEach((treino, tIdx) => {
      // Cada treino (Treino A, Treino B, etc.) sempre começa em uma PÁGINA NOVA!
      if (tIdx > 0) {
        doc.addPage();
      }
      let y = renderPageHeader(tIdx === 0);

      // Banner do Treino (Verde Rumpel #16a34a)
      doc.setFillColor(22, 163, 74); // Green 600
      doc.roundedRect(14, y + 2, pageWidth - 28, 8.5, 2, 2, 'F');
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(255, 255, 255);
      doc.text(`${treino.nomeTreino.toUpperCase()}`, 18, y + 7.5);
      y += 13.5;

      // Agrupar Exercícios por Blocos
      const limits = getBlockLimits(treino);
      const sortedLimits = Array.from(new Set(limits))
        .filter(idx => idx > 0 && idx < (treino.exercicios?.length || 0))
        .sort((a, b) => a - b);

      const blocks: { name: string; exercicios: typeof treino.exercicios }[] = [];
      let currentStart = 0;

      if (treino.exercicios && treino.exercicios.length > 0) {
        sortedLimits.forEach((lim) => {
          const chunk = treino.exercicios.slice(currentStart, lim);
          if (chunk.length > 0) {
            blocks.push({
              name: `BLOCO ${blocks.length + 1}`,
              exercicios: chunk
            });
          }
          currentStart = lim;
        });

        const finalChunk = treino.exercicios.slice(currentStart);
        if (finalChunk.length > 0) {
          blocks.push({
            name: `BLOCO ${blocks.length + 1}`,
            exercicios: finalChunk
          });
        }
      }

      if (blocks.length === 0) {
        doc.setFontSize(9);
        doc.setTextColor(148, 163, 184);
        doc.setFont("helvetica", "italic");
        doc.text("Nenhum exercício cadastrado para este dia.", 18, y);
        return;
      }

      // Renderizar blocos do treino em sequência na mesma página do treino
      blocks.forEach((block) => {
        // Se a página estiver quase cheia antes de iniciar um novo bloco, adiciona página
        if (y > pageHeight - 35) {
          doc.addPage();
          y = renderPageHeader(false);
        }

        // Subcabeçalho do Bloco (Verde Suave #DCFCE7 com Borda #86EFAC)
        doc.setFillColor(220, 252, 231);
        doc.setDrawColor(134, 239, 172);
        doc.roundedRect(14, y, pageWidth - 28, 6.5, 1, 1, 'FD');
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(20, 83, 45); // Dark Green #14532d
        doc.text(block.name, 18, y + 4.5);
        y += 6.5;

        const tableData = block.exercicios.map((ex, idx) => [
          (idx + 1).toString(),
          ex.categoria || '-',
          ex.nome || '-',
          ex.series || '-',
          ex.reps || '-',
          ex.intervalo || '-',
          ex.carga || '-'
        ]);

        autoTable(doc, {
          startY: y,
          head: [['#', 'Categoria', 'Exercício', 'Séries', 'Reps', 'Int. Rec.', 'Carga']],
          body: tableData,
          theme: 'grid',
          headStyles: {
            fillColor: [21, 128, 61], // Rumpel Green #15803d
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 9,
            halign: 'center'
          },
          styles: {
            fontSize: 8.5,
            cellPadding: 2.5,
            textColor: [30, 41, 59],
            valign: 'middle'
          },
          columnStyles: {
            0: { cellWidth: 8, halign: 'center' },
            1: { cellWidth: 28 },
            2: { cellWidth: 'auto', fontStyle: 'bold' },
            3: { cellWidth: 16, halign: 'center' },
            4: { cellWidth: 16, halign: 'center' },
            5: { cellWidth: 18, halign: 'center' },
            6: { cellWidth: 20, halign: 'center' }
          },
          margin: { left: 14, right: 14 }
        });

        const lastTable = (doc as any).lastAutoTable;
        if (lastTable && lastTable.finalY) {
          y = lastTable.finalY + 6;
        }
      });
    });

    // Rodapé em todas as páginas
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);

      // Linha Divisória de Rodapé
      doc.setDrawColor(187, 247, 208);
      doc.line(14, pageHeight - 10, pageWidth - 14, pageHeight - 10);

      doc.setFontSize(8);
      doc.setTextColor(22, 101, 52);
      doc.setFont("helvetica", "bold");
      doc.text(`RUMPEL TRAINING - Studio de Treinamento | Aluno(a): ${aluno.nome}`, 14, pageHeight - 5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(`Página ${i} de ${totalPages}`, pageWidth - 14, pageHeight - 5, { align: "right" });
    }

    doc.save(`Ficha_Treino_${aluno.nome.replace(/\s+/g, '_')}.pdf`);
  };

  const adicionarBloco = (treinoIndex: number) => {
    if(!alunoAtual) return;
    const newAluno = { ...alunoAtual };
    const treino = newAluno.treinos[treinoIndex];
    const N = treino.exercicios.length;

    let limits = [...getBlockLimits(treino)];

    if (limits.length === 0) {
      limits = [0];
    }

    const lastLimit = limits[limits.length - 1];
    if (N < lastLimit) {
      limits[limits.length - 1] = N;
    } else {
      limits.push(N);
    }

    treino.exercicios.push({
      id: `ex_${Date.now()}_${Math.random()}`,
      nome: "",
      categoria: "Forca",
      series: "3",
      reps: "10",
      intervalo: "",
      carga: "-"
    });

    treino.limitesBlocos = limits;
    treino.bloco2Desativado = undefined;
    treino.bloco3Desativado = undefined;
    treino.limiteBloco1 = undefined;
    treino.limiteBloco2 = undefined;

    setAlunoAtual(newAluno);
  };

  const removerBloco = (treinoIndex: number, limitIndex: number) => {
    if(!alunoAtual) return;
    const blockLabel = `BLOCO ${limitIndex + 1}`;
    const targetLabel = limitIndex === 0 ? 'exercícios acima do bloco' : `BLOCO ${limitIndex}`;
    if (confirm(`Deseja deletar a divisão do ${blockLabel}? Todos os exercícios passarão a fazer parte do ${targetLabel}.`)) {
      const newAluno = { ...alunoAtual };
      const treino = newAluno.treinos[treinoIndex];
      const limits = [...getBlockLimits(treino)];
      
      limits.splice(limitIndex, 1);
      
      treino.limitesBlocos = limits;
      treino.bloco2Desativado = undefined;
      treino.bloco3Desativado = undefined;
      treino.limiteBloco1 = undefined;
      treino.limiteBloco2 = undefined;
      
      setAlunoAtual(newAluno);
    }
  };

  const removerExercicio = (treinoIndex: number, exIndex: number) => {
    if (confirm("Remover este exercício?")) {
      if(!alunoAtual) return;
      const newAluno = { ...alunoAtual };
      const treino = newAluno.treinos[treinoIndex];

      const limits = [...getBlockLimits(treino)];

      treino.exercicios.splice(exIndex, 1);

      const newLimits = limits.map(limit => {
        if (limit > exIndex) {
          return limit - 1;
        }
        return limit;
      }).filter((limit, idx, arr) => {
        if (limit < 0) return false;
        if (limit >= treino.exercicios.length) return false;
        if (idx > 0 && limit <= arr[idx - 1]) return false;
        return true;
      });

      treino.limitesBlocos = newLimits;
      treino.bloco2Desativado = undefined;
      treino.bloco3Desativado = undefined;
      treino.limiteBloco1 = undefined;
      treino.limiteBloco2 = undefined;

      setAlunoAtual(newAluno);
    }
  };

  const adicionarNovoTreino = () => {
     if(!alunoAtual) return;
     const newAluno = { ...alunoAtual };
     const sigla = String.fromCharCode(65 + newAluno.treinos.length); // A, B, C...
     newAluno.treinos.push({
         id: `t_${Date.now()}`,
         nomeTreino: `Treino ${sigla}`,
         exercicios: []
     });
     setAlunoAtual(newAluno);
     setActiveTab(newAluno.treinos.length - 1);
  };

  const limparNomesExercicios = (treinoIndex: number) => {
      if(confirm("Tem certeza que deseja limpar os nomes de todos os exercícios deste treino?")) {
         if(!alunoAtual) return;
         const newAluno = { ...alunoAtual };
         const treino = newAluno.treinos[treinoIndex];
         if (treino && treino.exercicios) {
           treino.exercicios.forEach(ex => {
             ex.nome = "";
           });
         }
         setAlunoAtual(newAluno);
      }
  };

  const excluirTreinoDia = (treinoIndex: number) => {
      if(confirm("Tem certeza que deseja excluir o treino deste dia?")) {
         if(!alunoAtual) return;
         const newAluno = { ...alunoAtual };
         newAluno.treinos.splice(treinoIndex, 1);
         setAlunoAtual(newAluno);
         setActiveTab(Math.max(0, treinoIndex - 1));
      }
  };

  const removerUltimoBloco = (treinoIndex: number) => {
      if (!alunoAtual) return;
      const treino = alunoAtual.treinos[treinoIndex];
      const limits = getBlockLimits(treino);
      if (limits.length === 0) {
        alert("Este treino não possui nenhum bloco para deletar.");
        return;
      }
      removerBloco(treinoIndex, limits.length - 1);
  };

  const limparTreinoEstrutura = (treinoIndex: number) => {
      if(confirm("Deseja apagar as cargas, repetições e nomes dos exercícios mantendo a estrutura (categorias)?")) {
         if(!alunoAtual) return;
         const newAluno = { ...alunoAtual };
         newAluno.treinos[treinoIndex].exercicios = newAluno.treinos[treinoIndex].exercicios.map((ex) => ({
             ...ex,
             nome: "",
             series: "",
             reps: "",
             intervalo: "",
             carga: ""
         }));
         setAlunoAtual(newAluno);
      }
  };

  const handleDropTab = (dropIndex: number) => {
    if (draggedTab === null || draggedTab === dropIndex || !alunoAtual) return;
    const newAluno = { ...alunoAtual };
    const items = Array.from(newAluno.treinos);
    const [reorderedItem] = items.splice(draggedTab, 1);
    items.splice(dropIndex, 0, reorderedItem);
    newAluno.treinos = items;
    setAlunoAtual(newAluno);
    setActiveTab(dropIndex);
    setDraggedTab(null);
  };

  const handleDropExercicio = (treinoIndex: number, dropIndex: number) => {
    if (draggedEx === null || draggedEx === dropIndex || !alunoAtual) return;
    const newAluno = { ...alunoAtual };
    const treino = newAluno.treinos[treinoIndex];
    const items = Array.from(treino.exercicios);
    const totalExercises = items.length;

    const currentLimits = getBlockLimits(treino);
    const sortedLimits = Array.from(new Set(currentLimits))
      .filter(idx => idx >= 0 && idx < totalExercises)
      .sort((a, b) => a - b);

    const getAssignmentForIndex = (exIdx: number) => {
      let bIdx = -1; // -1 means above BLOCO 1
      for (let i = 0; i < sortedLimits.length; i++) {
        if (exIdx >= sortedLimits[i]) {
          bIdx = i; // 0 = BLOCO 1, 1 = BLOCO 2...
        }
      }
      return bIdx;
    };

    const assignments = items.map((_, i) => getAssignmentForIndex(i));
    const targetAssignment = getAssignmentForIndex(dropIndex);

    const [reorderedItem] = items.splice(draggedEx, 1);
    items.splice(dropIndex, 0, reorderedItem);

    assignments.splice(draggedEx, 1);
    assignments.splice(dropIndex, 0, targetAssignment);

    // Recompute limits: find start index of each active block (bIdx >= 0)
    const mapFirstIdx = new Map<number, number>();
    assignments.forEach((bIdx, i) => {
      if (bIdx >= 0 && !mapFirstIdx.has(bIdx)) {
        mapFirstIdx.set(bIdx, i);
      }
    });

    const activeBlocks = Array.from(mapFirstIdx.keys()).sort((a, b) => a - b);
    const newLimits: number[] = activeBlocks.map(bIdx => mapFirstIdx.get(bIdx)!);

    treino.exercicios = items;
    treino.limitesBlocos = newLimits;
    treino.bloco2Desativado = undefined;
    treino.bloco3Desativado = undefined;
    treino.limiteBloco1 = undefined;
    treino.limiteBloco2 = undefined;
    treino.ordenadoManualmente = true;

    setAlunoAtual(newAluno);
    setDraggedEx(null);
  };

  const handleNovoAluno = () => {
    setNovoAlunoNome("");
    setNovoAlunoIntrodutorio(false);
    setShowNovoAlunoModal(true);
  };

  const confirmarCriarAluno = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!novoAlunoNome.trim()) {
      alert("Por favor, digite o nome do aluno.");
      return;
    }

    const newId = `a_${Date.now()}`;
    const novoAluno: Aluno = {
      id: newId,
      nome: formatNomeAluno(novoAlunoNome),
      treinos: [],
      dataFichaAtual: new Date().toLocaleDateString('pt-BR'),
      historico: [],
      observacoes: "",
      faseTreinamento: "",
      isIntrodutorio: novoAlunoIntrodutorio,
    };

    await mockDb.saveAluno(novoAluno);
    const updatedAlunos = await mockDb.getAlunos();
    setAlunos(updatedAlunos);
    selecionarAluno(newId, updatedAlunos);
    setShowNovoAlunoModal(false);
  };

  const handleEditarNome = () => {
    if (!alunoAtual) return;
    setEditarNomeValue(alunoAtual.nome);
    setShowEditarNomeModal(true);
  };

  const confirmarEditarNome = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!alunoAtual) return;
    if (!editarNomeValue.trim()) {
      alert("Por favor, digite um nome válido para o aluno.");
      return;
    }

    const novoNomeFormatado = formatNomeAluno(editarNomeValue);
    const alunoAtualizado: Aluno = {
      ...alunoAtual,
      nome: novoNomeFormatado,
    };

    await mockDb.saveAluno(alunoAtualizado);

    setAlunoAtual(alunoAtualizado);
    const updatedAlunos = await mockDb.getAlunos();
    setAlunos(updatedAlunos);
    setShowEditarNomeModal(false);
  };

  const alunosVencidos = (() => {
    return alunos.filter(a => {
      if (!a.historico || a.historico.length === 0 || !a.treinos || a.treinos.length === 0) return false;
      const dataReferenciaStr = a.dataFichaAtual || a.historico[0].data;
      const refParts = dataReferenciaStr.split('/');
      if(refParts.length !== 3) return false;
      const dataRef = new Date(parseInt(refParts[2]), parseInt(refParts[1]) - 1, parseInt(refParts[0]));
      
      const contagemTreinos: Record<string, number> = {};
      a.treinos.forEach(t => {
          contagemTreinos[t.nomeTreino] = 0;
      });

      a.historico.forEach(h => {
          const hParts = h.data.split('/');
          if(hParts.length !== 3) return;
          const hDate = new Date(parseInt(hParts[2]), parseInt(hParts[1]) - 1, parseInt(hParts[0]));
          if (hDate >= dataRef) {
              if (contagemTreinos[h.nomeTreino] !== undefined) {
                  contagemTreinos[h.nomeTreino]++;
              }
          }
      });
      
      const contagens = Object.values(contagemTreinos);
      const semanasCompletas = (contagens.length > 0 ? Math.min(...contagens) : 0) + (a.semanasConcluidas || 0);
      
      return semanasCompletas >= 6;
    });
  })();

  const handleLixeira = async () => {
    if (!alunoAtual) return;
    if (confirm(`Tem certeza que deseja mover ${alunoAtual.nome} para a lixeira? (Ele pode ser restaurado em até 60 dias)`)) {
      await mockDb.moverParaLixeira(alunoAtual.id);
      const updatedAlunos = await mockDb.getAlunos();
      setAlunos(updatedAlunos);
      if (updatedAlunos.length > 0) {
        selecionarAluno(updatedAlunos[0].id, updatedAlunos);
      } else {
        setAlunoAtual(null);
        setSelectedAlunoId("");
      }
      alert("Aluno movido para a lixeira.");
    }
  };

  if (loading) return (
    <div style={{ padding: '30px 20px', maxWidth: '1300px', margin: '0 auto 0 30px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem' }}>Carregando dados do Supabase...</p>
    </div>
  );

  if (alunos.length === 0) return (
    <div style={{ padding: '30px 20px', maxWidth: '1300px', margin: '0 auto 0 30px' }}>
        <button onClick={handleNovoAluno} className="premium-btn">
          <Plus size={20} /> Cadastrar Primeiro Aluno
        </button>
    </div>
  );

  const alunosFiltrados = alunos.filter(a => a.nome.toLowerCase().includes(busca.toLowerCase()));
  const progresso = getProgressoTreinos(alunoAtual);

  return (
    <div style={{ padding: '30px 20px 40px 30px', maxWidth: isComparing && versaoComparacaoId ? '1600px' : '1300px', margin: '0 auto 0 30px', transition: 'max-width 0.3s ease' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
        <div>
          <Link href="/" style={{ color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <ArrowLeft size={16} /> Voltar ao Início
          </Link>
          <h1 style={{ fontSize: '2rem', marginBottom: '8px' }}>Planilhas dos Alunos</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Gerencie as planilhas de treinamento individuais para cada aluno do estúdio.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {alunoAtual && (
            <>
              <button 
                onClick={() => setShowRelatorioModal(true)} 
                className="premium-btn" 
                style={{ background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <FileText size={20} /> Relatório de Progresso
              </button>
              <button onClick={handleLixeira} className="premium-btn-outline" style={{ color: 'var(--cat-explosao)', borderColor: 'var(--cat-explosao)' }}>
                <Trash2 size={20} /> Excluir Aluno
              </button>
            </>
          )}
          <button onClick={saveAluno} className="premium-btn">
            <Save size={20} /> Salvar Ficha do Aluno
          </button>
        </div>
      </header>

      {alunosVencidos.length > 0 && (
        <div style={{ background: '#FFEDD5', borderLeft: '5px solid #F97316', padding: '16px', borderRadius: '8px', marginBottom: '30px' }}>
            <h3 style={{ margin: '0 0 8px 0', color: '#9A3412', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
               ⚠️ Fichas Vencidas (6+ Semanas de Treino)
            </h3>
            <p style={{ margin: 0, color: '#C2410C', fontSize: '0.95rem', lineHeight: '1.5' }}>
               Baseado nas datas de presença, os seguintes alunos precisam de treino novo: <br/>
               <strong>{alunosVencidos.map(a => a.nome).join(', ')}</strong>
            </p>
        </div>
      )}

      {/* SELETOR DE ALUNO */}
      <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-light)', marginBottom: '30px', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Selecionar Aluno:</h3>
        
        <input 
            type="text" 
            placeholder="🔎 Buscar..." 
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{ 
              padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-medium)', 
              outline: 'none', background: 'var(--bg-main)', color: 'var(--text-primary)', width: '200px', fontSize: '1rem'
            }}
        />

        <select 
            value={selectedAlunoId} 
            onChange={handleSelectChange}
            style={{ padding: '12px', fontSize: '1.1rem', borderRadius: '8px', border: '1px solid var(--border-medium)', outline: 'none', background: 'var(--bg-main)', flex: 1, maxWidth: '400px' }}
        >
            {alunosFiltrados.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
            {alunosFiltrados.length === 0 && <option value="" disabled>Nenhum aluno encontrado</option>}
        </select>

        {alunoAtual && (
          <button 
            onClick={handleEditarNome} 
            title="Editar nome do aluno selecionado" 
            className="premium-btn-outline" 
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Pencil size={18} /> Editar Nome
          </button>
        )}

        <button onClick={handleNovoAluno} className="premium-btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: alunoAtual ? '0' : 'auto' }}>
          <Plus size={18} /> Novo Aluno
        </button>
      </div>

      {alunoAtual && (
          <>
            {/* INFORMAÇÕES DO ALUNO */}
            <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-light)', marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: '250px' }}>
                  <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 'bold', marginBottom: '8px' }}>
                    OBSERVAÇÕES MÉDICAS / LESÕES
                  </label>
                  <textarea 
                    value={alunoAtual.observacoes || ""} 
                    onChange={(e) => setAlunoAtual({...alunoAtual, observacoes: e.target.value})}
                    placeholder="Ex: Dor no joelho esquerdo, cirurgia no tornozelo recente..."
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-medium)', outline: 'none', background: 'var(--bg-main)', color: 'var(--text-primary)', resize: 'vertical', minHeight: '80px' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column' }}>
                  <label style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 'bold', marginBottom: '8px' }}>
                    FASE DO TREINAMENTO
                  </label>
                  <input 
                    type="text"
                    value={alunoAtual.faseTreinamento || ""} 
                    onChange={(e) => setAlunoAtual({...alunoAtual, faseTreinamento: e.target.value})}
                    placeholder="Ex: Adaptação, Força..."
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-medium)', outline: 'none', background: 'var(--bg-main)', color: 'var(--text-primary)', marginBottom: '8px' }}
                  />
                  <div style={{ marginBottom: '10px' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                      <input 
                        type="checkbox"
                        checked={!!alunoAtual.isIntrodutorio}
                        onChange={(e) => setAlunoAtual({...alunoAtual, isIntrodutorio: e.target.checked})}
                        style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#2563eb' }}
                      />
                      <span>Treino Introdutório</span>
                      <span style={{ fontSize: '0.78rem', color: '#2563eb', fontWeight: 600 }}>(Exibe em azul na TV)</span>
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold', marginBottom: '4px' }}>
                        ALTURA CMJ (cm)
                      </label>
                      <input 
                        type="number"
                        value={alunoAtual.alturaCmj || ""} 
                        onChange={(e) => setAlunoAtual({...alunoAtual, alturaCmj: e.target.value})}
                        placeholder="Ex: 45.5"
                        style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-medium)', outline: 'none', background: 'var(--bg-main)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div style={{ flex: '0 0 110px' }}>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title="SEMANAS CONCLUÍDAS">
                        SEM. CONCLUÍDAS
                      </label>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <input 
                          type="number"
                          value={semanasInput} 
                          onChange={(e) => {
                            const valStr = e.target.value;
                            setSemanasInput(valStr);
                            
                            const val = parseInt(valStr);
                            if (!isNaN(val) && alunoAtual) {
                              setAlunoAtual({
                                ...alunoAtual,
                                semanasConcluidas: val - progresso.minContagem
                              });
                            }
                          }}
                          onBlur={() => {
                            if (semanasInput === "") {
                              setSemanasInput(progresso.semanasCompletas.toString());
                            }
                          }}
                          placeholder="Ex: 3"
                          title="Alterar total de semanas concluídas"
                          style={{ flex: 1, padding: '12px 4px', borderRadius: '8px', border: '1px solid var(--border-medium)', outline: 'none', background: 'var(--bg-main)', color: 'var(--text-primary)', fontWeight: 'bold', fontSize: '1.1rem', textAlign: 'center', minWidth: '35px' }}
                        />
                        <div style={{
                          padding: '12px 8px', borderRadius: '8px', border: '1px solid var(--border-medium)',
                          background: 'var(--bg-hover)', color: 'var(--text-primary)', fontWeight: 'bold', fontSize: '1.1rem'
                        }}>
                          / 6
                        </div>
                      </div>
                    </div>

                  </div>
                  <button 
                    onClick={() => {
                        if(confirm("Confirmar que este aluno está começando uma FICHA NOVA hoje? Isso irá salvar a ficha atual no histórico como versão passada e zerar a contagem de 6 semanas.")) {
                            const dataAtual = new Date().toLocaleDateString('pt-BR');
                            const novaVersao = {
                                id: `v_${Date.now()}`,
                                dataInicio: alunoAtual.dataFichaAtual || "Desconhecida",
                                dataTermino: dataAtual,
                                faseTreinamento: alunoAtual.faseTreinamento || "-",
                                treinos: JSON.parse(JSON.stringify(alunoAtual.treinos))
                            };
                            const versoes = alunoAtual.versoesAnteriores ? [...alunoAtual.versoesAnteriores] : [];
                            versoes.push(novaVersao);
                            setAlunoAtual({
                                ...alunoAtual,
                                dataFichaAtual: dataAtual,
                                versoesAnteriores: versoes,
                                semanasConcluidas: 0
                            });
                            alert("Cópia da ficha salva no histórico e contagem resetada para hoje!");
                        }
                    }}
                    className="premium-btn-outline" 
                    style={{ marginTop: 'auto', alignSelf: 'flex-start', color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)', fontSize: '0.9rem' }}
                  >
                    Renovar Ficha (Resetar Semanas)
                  </button>
                </div>
              </div>
            </div>

            {/* PROGRESSO E HISTÓRICO DE TREINOS */}
            <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-light)', marginBottom: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                {/* Lado Esquerdo: Progresso */}
                <div style={{ paddingRight: '10px' }}>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                    📊 Progresso para Mudança de Ficha (Meta: 6 Semanas)
                  </h3>
                  
                  {/* Progress Bar */}
                  <div style={{ background: 'var(--bg-main)', height: '24px', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-medium)', marginBottom: '15px', position: 'relative' }}>
                    <div style={{
                      width: `${Math.min(100, (progresso.semanasCompletas / 6) * 100)}%`,
                      height: '100%',
                      background: progresso.semanasCompletas >= 6 ? '#22c55e' : '#3b82f6',
                      transition: 'width 0.4s ease'
                    }} />
                    <span style={{
                      position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                      fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-primary)', mixBlendMode: 'difference'
                    }}>
                      {progresso.semanasCompletas} de 6 semanas ({Math.round(Math.min(100, (progresso.semanasCompletas / 6) * 100))}%)
                    </span>
                  </div>

                  <p style={{ margin: '0 0 10px 0', fontSize: '0.95rem' }}>
                    {progresso.semanasCompletas >= 6 ? (
                      <strong style={{ color: '#22c55e' }}>🎉 Meta alcançada! Ficha pronta para renovação.</strong>
                    ) : (
                      <>
                        Faltam <strong>{Math.max(0, 6 - progresso.semanasCompletas)}</strong> semanas de treino.
                      </>
                    )}
                  </p>

                  {/* Faltam Treinos Detalhados */}
                  {progresso.semanasCompletas < 6 && (
                    <div style={{ background: 'var(--bg-main)', padding: '10px 15px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                      <p style={{ margin: '0 0 5px 0', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>Treinos restantes para completar 6 semanas:</p>
                      {progresso.treinosFaltandoDetalhado.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.9rem' }}>
                          {progresso.treinosFaltandoDetalhado.map((item, idx) => (
                            <li key={idx} style={{ color: 'var(--text-primary)' }}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Realize todos os dias recomendados.</p>
                      )}
                    </div>
                  )}

                  <div style={{ marginTop: '15px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Data de início desta ficha: <strong>{progresso.dataRefStr}</strong>
                  </div>

                  <button 
                    onClick={() => alunoAtual && gerarPdfTreino(alunoAtual)}
                    className="premium-btn"
                    style={{ marginTop: '15px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', color: '#fff' }}
                  >
                    <Download size={18} /> Exportar Treino para PDF
                  </button>
                </div>

                {/* Lado Direito: Histórico */}
                <div>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                    📅 Histórico de Treinos Realizados ({alunoAtual.historico ? alunoAtual.historico.length : 0})
                  </h3>
                  
                  <div style={{
                    maxHeight: '180px',
                    overflowY: 'auto',
                    background: 'var(--bg-main)',
                    borderRadius: '8px',
                    border: '1px solid var(--border-light)',
                    padding: '10px'
                  }}>
                    {alunoAtual.historico && alunoAtual.historico.length > 0 ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-medium)', textAlign: 'left' }}>
                            <th style={{ padding: '6px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>DATA</th>
                            <th style={{ padding: '6px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>TREINO</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...alunoAtual.historico].reverse().map((h, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border-light)' }}>
                              <td style={{ padding: '6px', fontWeight: 500, color: 'var(--text-primary)' }}>{h.data}</td>
                              <td style={{ padding: '6px' }}>
                                <span style={{
                                  background: 'var(--bg-card)', padding: '2px 8px', borderRadius: '4px',
                                  fontSize: '0.85rem', fontWeight: 'bold', border: '1px solid var(--border-medium)',
                                  color: 'var(--text-primary)'
                                }}>
                                  {h.nomeTreino}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        Nenhum treino registrado no histórico para esta ficha.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* TABS */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                {alunoAtual.treinos.map((t, idx) => (
                <button
                    key={t.id}
                    draggable
                    onDragStart={() => setDraggedTab(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDropTab(idx)}
                    onClick={() => setActiveTab(idx)}
                    className={activeTab === idx ? "premium-btn" : "premium-btn-outline"}
                    style={{ padding: '10px 30px', fontSize: '1.2rem', background: activeTab === idx ? '#3b82f6' : undefined, borderColor: activeTab === idx ? '#3b82f6' : undefined, cursor: 'grab' }}
                >
                    {t.nomeTreino}
                </button>
                ))}
                
                <button onClick={adicionarNovoTreino} className="premium-btn-outline" style={{ padding: '10px 20px', borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}>
                    + Novo Dia
                </button>

                {alunoAtual.treinos.length === 0 && (
                     <button onClick={aplicarFichaInicial} className="premium-btn" style={{ marginLeft: 'auto', background: 'var(--cat-core)' }}>
                        <CopyCheck size={18} /> Iniciar com Ficha Padrão
                     </button>
                )}
            </div>

            {/* COMPARADOR CONTROLES */}
            {alunoAtual.versoesAnteriores && alunoAtual.versoesAnteriores.length > 0 && (
                <div style={{ marginBottom: '20px', padding: '15px', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-medium)', display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <label style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>Comparar com Versão Passada:</label>
                    <select 
                        value={versaoComparacaoId}
                        onChange={(e) => {
                            setVersaoComparacaoId(e.target.value);
                            setIsComparing(e.target.value !== "");
                        }}
                        style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-medium)', outline: 'none' }}
                    >
                        <option value="">Desligado (Somente Editor)</option>
                        {alunoAtual.versoesAnteriores.map((v) => (
                            <option key={v.id} value={v.id}>Versão: {v.dataInicio} até {v.dataTermino}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* Editor Content */}
            {alunoAtual.treinos.length > 0 && activeTab < alunoAtual.treinos.length && (
            <div style={{ display: 'grid', gridTemplateColumns: isComparing && versaoComparacaoId ? '1fr 1fr' : '1fr', gap: '20px' }}>
                
                {/* COLUNA ESQUERDA: EDITOR */}
                <div style={{ background: 'var(--bg-card)', padding: '30px', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <h2 style={{ fontSize: '1.5rem', margin: 0, color: 'var(--text-primary)' }}>Novo: </h2>
                        <input 
                            value={alunoAtual.treinos[activeTab].nomeTreino}
                            onChange={(e) => {
                                const newAluno = {...alunoAtual};
                                newAluno.treinos[activeTab].nomeTreino = e.target.value;
                                setAlunoAtual(newAluno);
                            }}
                            style={{ fontSize: '1.5rem', fontWeight: 600, border: 'none', borderBottom: '2px solid var(--border-medium)', outline: 'none', background: 'transparent', width: '150px' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <select 
                            onChange={(e) => {
                                const modeloStr = e.target.value;
                                if (!modeloStr) return;
                                
                                if (modeloStr === 'MANAGE_BASES') {
                                    setShowBasesModal(true);
                                    e.target.value = "";
                                    return;
                                }

                                // Check if it's a custom base (prefixed with 'custom:')
                                const isCustom = modeloStr.startsWith('custom:');
                                let exerciciosParaImportar: Exercicio[] = [];
                                let nomeModelo = modeloStr;
                                
                                if (isCustom) {
                                    const baseId = modeloStr.replace('custom:', '');
                                    const base = basesCustom.find(b => b.id === baseId);
                                    if (base) {
                                        exerciciosParaImportar = base.exercicios;
                                        nomeModelo = base.nome;
                                    }
                                } else {
                                    exerciciosParaImportar = MODELOS_ESTUDIO[modeloStr] || [];
                                    nomeModelo = modeloStr;
                                }
                                
                                if (confirm(`Deseja importar e substituir este dia pelo modelo ${nomeModelo}? Isso irá APAGAR os exercícios atuais deste dia.`)) {
                                    if (!alunoAtual) return;
                                    const newAluno = { ...alunoAtual };
                                    const copiados = JSON.parse(JSON.stringify(exerciciosParaImportar));
                                    
                                    // Extract block limits if stored on the first exercise
                                    let limitesExtras: number[] | undefined = undefined;
                                    if (copiados.length > 0 && copiados[0].limitesBlocos) {
                                        limitesExtras = copiados[0].limitesBlocos;
                                        delete copiados[0].limitesBlocos;
                                    }

                                    if (isCustom) {
                                        const baseId = modeloStr.replace('custom:', '');
                                        const base = basesCustom.find(b => b.id === baseId);
                                        if (base && base.limitesBlocos) {
                                            limitesExtras = limitesExtras || base.limitesBlocos;
                                        }
                                    }

                                    // Fallback when limits not specified: 5-exercise workouts get [3], 8+ exercise workouts get [5, 8]
                                    if (!limitesExtras) {
                                        if (copiados.length === 5) {
                                            limitesExtras = [3];
                                        } else if (copiados.length >= 8) {
                                            limitesExtras = [5, 8];
                                        }
                                    }

                                    copiados.forEach((ex: Exercicio) => ex.id = `ex_${Date.now()}_${Math.random()}`);
                                    newAluno.treinos[activeTab].exercicios = copiados;
                                    newAluno.treinos[activeTab].limitesBlocos = limitesExtras ? [...limitesExtras] : undefined;

                                    newAluno.treinos[activeTab].bloco2Desativado = undefined;
                                    newAluno.treinos[activeTab].bloco3Desativado = undefined;
                                    newAluno.treinos[activeTab].limiteBloco1 = undefined;
                                    newAluno.treinos[activeTab].limiteBloco2 = undefined;
                                    newAluno.treinos[activeTab].ordenadoManualmente = true;

                                    setAlunoAtual(newAluno);
                                }
                                e.target.value = "";
                            }}
                            className="premium-btn-outline"
                            style={{ outline: 'none', background: 'var(--bg-main)', cursor: 'pointer', appearance: 'none', paddingRight: '20px' }}
                            title="Importar Modelo Pré-Pronto"
                        >
                            <option value="">📥 Importar Base</option>
                            {basesCustom.map(base => (
                                <option key={base.id} value={`custom:${base.id}`}>⭐ {base.nome}</option>
                            ))}
                            <option value="MANAGE_BASES">⚙️ Gerenciar / Excluir Bases...</option>
                        </select>
                        <button 
                            onClick={async () => {
                                if (!alunoAtual || alunoAtual.treinos.length === 0) return;
                                const treino = alunoAtual.treinos[activeTab];
                                if (treino.exercicios.length === 0) {
                                    alert('Este treino não possui exercícios para salvar como base.');
                                    return;
                                }
                                const nomeBase = window.prompt(
                                    'Nome para esta base de treino:',
                                    treino.nomeTreino
                                );
                                if (!nomeBase) return;
                                
                                // Check if a base with same name already exists
                                const existente = basesCustom.find(b => b.nome.toLowerCase() === nomeBase.toLowerCase());
                                const currentLimits = getBlockLimits(treino);
                                const exerciciosCopiados = JSON.parse(JSON.stringify(treino.exercicios));
                                if (exerciciosCopiados.length > 0) {
                                    exerciciosCopiados[0].limitesBlocos = currentLimits;
                                }

                                if (existente) {
                                    if (!confirm(`Já existe uma base com o nome "${existente.nome}". Deseja substituí-la?`)) return;
                                    // Overwrite existing
                                    const baseAtualizada: BaseTreino = {
                                        id: existente.id,
                                        nome: nomeBase,
                                        exercicios: exerciciosCopiados,
                                        limitesBlocos: currentLimits,
                                    };
                                    await mockDb.saveBase(baseAtualizada);
                                } else {
                                    const novaBase: BaseTreino = {
                                        id: `base_${Date.now()}`,
                                        nome: nomeBase,
                                        exercicios: exerciciosCopiados,
                                        limitesBlocos: currentLimits,
                                    };
                                    await mockDb.saveBase(novaBase);
                                }
                                
                                const updated = await mockDb.getBases();
                                setBasesCustom(updated);
                                alert(`Base "${nomeBase}" salva com sucesso! Agora pode ser importada para qualquer aluno.`);
                            }}
                            className="premium-btn-outline"
                            style={{ color: '#8b5cf6', borderColor: '#8b5cf6' }}
                            title="Salvar este treino como base reutilizável"
                        >
                            <Upload size={18} /> Salvar como Base
                        </button>
                        <button 
                            onClick={() => setShowBasesModal(true)}
                            className="premium-btn-outline"
                            style={{ color: '#6366f1', borderColor: '#6366f1', display: 'flex', alignItems: 'center', gap: '6px' }}
                            title="Gerenciar e excluir bases de treino salvas"
                        >
                            <BookOpen size={18} /> Gerenciar / Excluir Bases
                        </button>
                        <button 
                            onClick={() => limparNomesExercicios(activeTab)} 
                            className="premium-btn-outline" 
                            style={{ color: '#d97706', borderColor: '#d97706' }}
                            title="Limpar o nome de todos os exercícios deste treino"
                        >
                            <Eraser size={18} /> Limpar
                        </button>
                        <button 
                            onClick={() => excluirTreinoDia(activeTab)} 
                            className="premium-btn-outline" 
                            style={{ color: 'var(--cat-explosao)', borderColor: 'var(--cat-explosao)' }} 
                            title="Deletar o treino do dia selecionado"
                        >
                            <Trash2 size={18} /> Deletar Treino
                        </button>
                        <button 
                            onClick={() => adicionarBloco(activeTab)} 
                            className="premium-btn-outline" 
                            style={{ color: '#8b5cf6', borderColor: '#8b5cf6' }} 
                            title="Adicionar um novo Bloco de Exercícios"
                        >
                            <Plus size={18} /> Bloco
                        </button>
                        <button onClick={() => adicionarExercicio(activeTab)} className="premium-btn-outline" style={{ color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }}>
                            <Plus size={18} /> Exercício
                        </button>
                    </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {(() => {
                        const limits = getBlockLimits(alunoAtual.treinos[activeTab]);
                        let exerciseCounter = 0;

                        return alunoAtual.treinos[activeTab].exercicios.map((ex, exIdx, arr) => {
                            exerciseCounter++;
                            let showBlock = false;
                            let blockLabel = '';
                            let limitIdx = -1;

                            const matchIdx = limits.indexOf(exerciseCounter - 1);
                            if (matchIdx !== -1) {
                                showBlock = true;
                                blockLabel = `BLOCO ${matchIdx + 1}`;
                                limitIdx = matchIdx;
                            }

                            return (
                                <div key={ex.id}>
                                    {showBlock && (
                                        <div style={{ 
                                            marginBottom: '10px', 
                                            padding: '5px 10px', 
                                            background: 'var(--bg-hover)', 
                                            borderRadius: '6px', 
                                            borderLeft: '4px solid var(--cat-forca)',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}>
                                            <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{blockLabel}</span>
                                            {limitIdx !== -1 && (
                                                <button 
                                                    onClick={() => removerBloco(activeTab, limitIdx)}
                                                    style={{ 
                                                        background: 'transparent', 
                                                        border: 'none', 
                                                        color: 'var(--cat-explosao)', 
                                                        cursor: 'pointer',
                                                        fontSize: '0.85rem',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        fontWeight: 'bold'
                                                    }}
                                                    title={`Deletar ${blockLabel} e mesclar`}
                                                >
                                                    <Trash2 size={14} /> Deletar Bloco
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    <div 
                                      draggable
                                      onDragStart={() => setDraggedEx(exIdx)}
                                      onDragOver={(e) => e.preventDefault()}
                                      onDrop={() => handleDropExercicio(activeTab, exIdx)}
                                      style={{ display: 'flex', gap: '15px', alignItems: 'center', padding: '15px', background: draggedEx === exIdx ? 'var(--bg-hover)' : 'var(--bg-main)', borderRadius: '8px', border: '1px solid var(--border-light)', cursor: 'grab', transition: 'all 0.2s' }}
                                    >
                                         <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', paddingRight: '5px' }}>
                                             {(() => {
                                              const canMoveUp = exIdx > 0 || (exIdx === 0 && limits.length > 0 && limits[0] === 0);
                                              return (
                                                  <button 
                                                      onClick={(e) => {
                                                          e.stopPropagation();
                                                          moverExercicio(activeTab, exIdx, 'up');
                                                      }}
                                                      disabled={!canMoveUp}
                                                      style={{ background: 'transparent', border: 'none', padding: '2px', cursor: !canMoveUp ? 'not-allowed' : 'pointer', color: !canMoveUp ? 'var(--border-medium)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                      title="Mover para cima"
                                                  >
                                                      <ChevronUp size={16} />
                                                  </button>
                                              );
                                          })()}
                                             <div style={{ cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Arraste para reposicionar">
                                                 <GripVertical size={16} />
                                             </div>
                                             <button 
                                                 onClick={(e) => {
                                                     e.stopPropagation();
                                                     moverExercicio(activeTab, exIdx, 'down');
                                                 }}
                                                 disabled={exIdx === arr.length - 1}
                                                 style={{ background: 'transparent', border: 'none', padding: '2px', cursor: exIdx === arr.length - 1 ? 'not-allowed' : 'pointer', color: exIdx === arr.length - 1 ? 'var(--border-medium)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                 title="Mover para baixo"
                                             >
                                                 <ChevronDown size={16} />
                                             </button>
                                         </div>
                        
                        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>EXERCÍCIO</label>
                            <input 
                            value={ex.nome ?? ''} 
                            onChange={(e) => handleExercicioChange(activeTab, exIdx, 'nome', e.target.value)}
                            placeholder="Nome do exercício"
                            style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-medium)', outline: 'none', background: 'var(--bg-card)' }}
                            />
                        </div>

                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>CATEGORIA</label>
                            <select 
                            value={ex.categoria ?? 'Core'} 
                            onChange={(e) => handleExercicioChange(activeTab, exIdx, 'categoria', e.target.value)}
                            style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-medium)', outline: 'none', background: 'white' }}
                            >
                            <option value="Core">Core</option>
                            <option value="Potencia">Potência</option>
                            <option value="Forca">Força</option>
                            <option value="Isometria">Isometria</option>
                            </select>
                        </div>

                        <div style={{ width: '90px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>CARGA</label>
                            <input 
                            value={ex.carga ?? ''} 
                            onChange={(e) => handleExercicioChange(activeTab, exIdx, 'carga', e.target.value)}
                            style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-medium)', outline: 'none', textAlign: 'center', background: 'var(--bg-card)' }}
                            />
                        </div>

                        <div style={{ width: '80px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>
                                {(ex.categoria || '').toUpperCase() === 'ISOMETRIA' ? 'TEMPO' : 'REPS'}
                            </label>
                            <input 
                            value={ex.reps ?? ''} 
                            onChange={(e) => handleExercicioChange(activeTab, exIdx, 'reps', e.target.value)}
                            placeholder={(ex.categoria || '').toUpperCase() === 'ISOMETRIA' ? 'Ex: 30"' : ''}
                            style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-medium)', outline: 'none', textAlign: 'center', background: 'var(--bg-card)' }}
                            />
                        </div>

                        <div style={{ width: '90px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>INT. REC.</label>
                            <input 
                            value={ex.intervalo ?? ''} 
                            onChange={(e) => handleExercicioChange(activeTab, exIdx, 'intervalo', e.target.value)}
                            placeholder='Ex: 45"'
                            style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-medium)', outline: 'none', textAlign: 'center', background: 'var(--bg-card)' }}
                            />
                        </div>

                        <div style={{ width: '80px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>SÉRIES</label>
                            <input 
                            value={ex.series ?? ''} 
                            onChange={(e) => handleExercicioChange(activeTab, exIdx, 'series', e.target.value)}
                            style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-medium)', outline: 'none', textAlign: 'center', background: 'var(--bg-card)' }}
                            />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'flex-end', height: '60px', paddingBottom: '2px' }}>
                            <button 
                            onClick={() => removerExercicio(activeTab, exIdx)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--cat-explosao)', cursor: 'pointer', padding: '10px' }}
                            title="Remover Exercício"
                            >
                            <Trash2 size={24} />
                            </button>
                        </div>

                        </div>
                    </div>
                                )
                            })
                        })()}
                    
                    {alunoAtual.treinos[activeTab].exercicios.length === 0 && (
                        <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Nenhum exercício neste treino. Seus alunos não terão o que fazer!
                        </div>
                    )}
                    </div>

                    {/* PROTOCOLO DE BIKE (Dias de Chuva) */}
                    {(() => {
                        const treinoAtivo = alunoAtual.treinos[activeTab];
                        const protocolo = treinoAtivo.protocoloBike || { ativo: false };
                        
                        // Cálculos das zonas de potência (110%, 115%, 120%)
                        const avgNum = parseFloat(protocolo.avg || '');
                        const avg110 = !isNaN(avgNum) ? Math.round(avgNum * 1.10) : null;
                        const avg115 = !isNaN(avgNum) ? Math.round(avgNum * 1.15) : null;
                        const avg120 = !isNaN(avgNum) ? Math.round(avgNum * 1.20) : null;

                        return (
                            <div style={{ 
                                marginTop: '30px', 
                                borderTop: '2px solid var(--border-light)', 
                                paddingTop: '20px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '15px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                                    <h3 style={{ fontSize: '1.2rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                                        🚴 Protocolo de Bike (Condicionamento pós-treino / Chuva)
                                    </h3>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.95rem', userSelect: 'none' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={protocolo.ativo}
                                            onChange={(e) => handleUpdateProtocolo('ativo', e.target.checked)}
                                            style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent-primary)' }}
                                        />
                                        <span>Ativar Protocolo</span>
                                    </label>
                                </div>

                                {protocolo.ativo && (
                                    <div style={{ 
                                        background: 'var(--bg-main)', 
                                        padding: '20px', 
                                        borderRadius: '10px', 
                                        border: '1px solid var(--border-medium)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '15px'
                                    }}>
                                        {/* Grid de Inputs */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '15px' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 'bold', marginBottom: '6px' }}>
                                                    DATA DO TESTE
                                                </label>
                                                <input 
                                                    type="date"
                                                    value={protocolo.data || ''}
                                                    onChange={(e) => handleUpdateProtocolo('data', e.target.value)}
                                                    style={{ 
                                                        width: '100%', 
                                                        padding: '10px', 
                                                        borderRadius: '6px', 
                                                        border: '1px solid var(--border-medium)', 
                                                        background: 'var(--bg-card)', 
                                                        color: 'var(--text-primary)',
                                                        outline: 'none'
                                                    }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 'bold', marginBottom: '6px' }}>
                                                    TESTE APLICADO
                                                </label>
                                                <input 
                                                    type="text"
                                                    placeholder="Ex: 5 Minutos"
                                                    value={protocolo.teste || ''}
                                                    onChange={(e) => handleUpdateProtocolo('teste', e.target.value)}
                                                    style={{ 
                                                        width: '100%', 
                                                        padding: '10px', 
                                                        borderRadius: '6px', 
                                                        border: '1px solid var(--border-medium)', 
                                                        background: 'var(--bg-card)', 
                                                        color: 'var(--text-primary)',
                                                        outline: 'none'
                                                    }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 'bold', marginBottom: '6px' }}>
                                                    TEMPO
                                                </label>
                                                <input 
                                                    type="text"
                                                    placeholder="Ex: 20 min"
                                                    value={protocolo.tempo || ''}
                                                    onChange={(e) => handleUpdateProtocolo('tempo', e.target.value)}
                                                    style={{ 
                                                        width: '100%', 
                                                        padding: '10px', 
                                                        borderRadius: '6px', 
                                                        border: '1px solid var(--border-medium)', 
                                                        background: 'var(--bg-card)', 
                                                        color: 'var(--text-primary)',
                                                        outline: 'none'
                                                    }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 'bold', marginBottom: '6px' }}>
                                                    AVG (Watts / BPM)
                                                </label>
                                                <input 
                                                    type="number"
                                                    placeholder="Ex: 200"
                                                    value={protocolo.avg || ''}
                                                    onChange={(e) => handleUpdateProtocolo('avg', e.target.value)}
                                                    style={{ 
                                                        width: '100%', 
                                                        padding: '10px', 
                                                        borderRadius: '6px', 
                                                        border: '1px solid var(--border-medium)', 
                                                        background: 'var(--bg-card)', 
                                                        color: 'var(--text-primary)',
                                                        outline: 'none'
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        {/* Cálculos das Zonas */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                                            <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                                                Zonas Calculadas (% da AVG)
                                            </span>
                                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px' }}>
                                                <div style={{ 
                                                    flex: 1, 
                                                    minWidth: '100px', 
                                                    background: 'rgba(59, 130, 246, 0.1)', 
                                                    border: '1px solid rgba(59, 130, 246, 0.3)',
                                                    padding: '8px 12px', 
                                                    borderRadius: '6px',
                                                    textAlign: 'center' 
                                                }}>
                                                    <div style={{ fontSize: '0.75rem', color: '#3b82f6', fontWeight: 'bold' }}>110%</div>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                                        {avg110 !== null ? `${avg110} W` : '-'}
                                                    </div>
                                                </div>
                                                <div style={{ 
                                                    flex: 1, 
                                                    minWidth: '100px', 
                                                    background: 'rgba(249, 115, 22, 0.1)', 
                                                    border: '1px solid rgba(249, 115, 22, 0.3)',
                                                    padding: '8px 12px', 
                                                    borderRadius: '6px',
                                                    textAlign: 'center' 
                                                }}>
                                                    <div style={{ fontSize: '0.75rem', color: '#f97316', fontWeight: 'bold' }}>115%</div>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                                        {avg115 !== null ? `${avg115} W` : '-'}
                                                    </div>
                                                </div>
                                                <div style={{ 
                                                    flex: 1, 
                                                    minWidth: '100px', 
                                                    background: 'rgba(239, 68, 68, 0.1)', 
                                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                                    padding: '8px 12px', 
                                                    borderRadius: '6px',
                                                    textAlign: 'center' 
                                                }}>
                                                    <div style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 'bold' }}>120%</div>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                                        {avg120 !== null ? `${avg120} W` : '-'}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Anotação de Resultados */}
                                        <div>
                                            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 'bold', marginBottom: '6px' }}>
                                                RESULTADOS DO TESTE E ANOTAÇÕES
                                            </label>
                                            <textarea 
                                                rows={3}
                                                placeholder="Anote aqui os resultados (RPM, watts atingidos, fadiga, observações gerais do atleta...)"
                                                value={protocolo.resultados || ''}
                                                onChange={(e) => handleUpdateProtocolo('resultados', e.target.value)}
                                                style={{ 
                                                    width: '100%', 
                                                    padding: '10px', 
                                                    borderRadius: '6px', 
                                                    border: '1px solid var(--border-medium)', 
                                                    background: 'var(--bg-card)', 
                                                    color: 'var(--text-primary)',
                                                    outline: 'none',
                                                    resize: 'vertical'
                                                }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </div>

                {/* COLUNA DIREITA: VISAO READONLY DA VERSAO ANTIGA */}
                {isComparing && versaoComparacaoId && (
                    <div style={{ background: '#f8fafc', padding: '30px', borderRadius: '12px', border: '1px dashed var(--border-medium)' }}>
                        {(() => {
                            const versaoAnterior = alunoAtual.versoesAnteriores?.find(v => v.id === versaoComparacaoId);
                            if (!versaoAnterior) return <div>Versão não encontrada.</div>;

                            // Tentar achar o mesmo treino pelo nome (Treino A == Treino A)
                            const treinoAtualNome = alunoAtual.treinos[activeTab].nomeTreino;
                            const treinoAnterior = versaoAnterior.treinos.find(t => t.nomeTreino === treinoAtualNome) || versaoAnterior.treinos[activeTab];

                            if(!treinoAnterior) return <div style={{ color: 'var(--text-muted)' }}>Não havia equivalente a este treino na versão passada.</div>;

                            const limits = getBlockLimits(treinoAnterior);
                            let exerciseCounter = 0;

                            return (
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                                        <h2 style={{ fontSize: '1.5rem', margin: 0, color: '#64748b' }}>Antigo: <span style={{ fontWeight: 400 }}>{treinoAnterior.nomeTreino}</span></h2>
                                    </div>
                                    
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                        {treinoAnterior.exercicios.map((ex, exIdx, arr) => {
                                            exerciseCounter++;
                                            let showBlock = false;
                                            let blockLabel = '';

                                            const matchIdx = limits.indexOf(exerciseCounter - 1);
                                            if (matchIdx !== -1) {
                                                showBlock = true;
                                                blockLabel = `BLOCO ${matchIdx + 1}`;
                                            }

                                            return (
                                                <div key={ex.id}>
                                                    {showBlock && (
                                                        <div style={{ marginBottom: '10px', padding: '5px 10px', background: '#e2e8f0', borderRadius: '6px', borderLeft: '4px solid #94a3b8' }}>
                                                            <span style={{ fontWeight: 800, color: '#64748b', fontSize: '0.9rem' }}>{blockLabel}</span>
                                                        </div>
                                                    )}
                                                    
                                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '12px', background: 'white', borderRadius: '8px', border: '1px solid #cbd5e1', opacity: 0.8 }}>
                                                        <div style={{ flex: 2 }}>
                                                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'bold' }}>EXERCÍCIO</div>
                                                            <div style={{ fontWeight: 500, color: '#334155' }}>{ex.nome || '-'}</div>
                                                        </div>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'bold' }}>CATEGORIA</div>
                                                            <div style={{ color: '#475569' }}>{ex.categoria}</div>
                                                        </div>
                                                        <div style={{ width: '70px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'bold' }}>CARGA</div>
                                                            <div style={{ color: '#475569', fontWeight: 'bold' }}>{ex.carga || '-'}</div>
                                                        </div>
                                                        <div style={{ width: '60px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'bold' }}>
                                                                {(ex.categoria || '').toUpperCase() === 'ISOMETRIA' ? 'TEMPO' : 'REPS'}
                                                            </div>
                                                            <div style={{ color: '#475569' }}>{ex.reps || '-'}</div>
                                                        </div>
                                                        <div style={{ width: '65px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'bold' }}>INT. REC.</div>
                                                            <div style={{ color: '#475569' }}>{ex.intervalo || '-'}</div>
                                                        </div>
                                                        <div style={{ width: '60px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'bold' }}>SÉRIES</div>
                                                            <div style={{ color: '#475569' }}>{ex.series || '-'}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                        {treinoAnterior.exercicios.length === 0 && (
                                            <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
                                                Nenhum exercício na ficha antiga.
                                            </div>
                                        )}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                )}
            </div>
            )}
          </>
      )}

      {/* MODAL GERENCIAR BASES */}
      {showBasesModal && (
          <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 9999, backdropFilter: 'blur(4px)'
          }}>
              <div style={{
                  background: 'var(--bg-card)', borderRadius: '16px', padding: '30px',
                  width: '500px', maxWidth: '90vw', maxHeight: '70vh', overflow: 'auto',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.3)', border: '1px solid var(--border-light)'
              }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                      <h2 style={{ margin: 0, fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <BookOpen size={22} /> Minhas Bases
                      </h2>
                      <button onClick={() => setShowBasesModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                          <X size={24} />
                      </button>
                  </div>
                  
                  {basesCustom.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>Nenhuma base salva ainda.</p>
                  ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {basesCustom.map(base => (
                              <div key={base.id} style={{
                                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                  padding: '14px 16px', background: 'var(--bg-main)', borderRadius: '10px',
                                  border: '1px solid var(--border-light)', transition: 'all 0.2s'
                              }}>
                                  <div>
                                      <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>⭐ {base.nome}</div>
                                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                          {base.exercicios.length} exercício{base.exercicios.length !== 1 ? 's' : ''}
                                      </div>
                                  </div>
                                  <button 
                                      onClick={async () => {
                                          if (confirm(`Tem certeza que deseja excluir a base "${base.nome}"?`)) {
                                              await mockDb.deleteBase(base.id);
                                              const updated = await mockDb.getBases();
                                              setBasesCustom(updated);
                                              if (updated.length === 0) setShowBasesModal(false);
                                          }
                                      }}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cat-explosao)', padding: '8px' }}
                                      title="Excluir base"
                                  >
                                      <Trash2 size={18} />
                                  </button>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* MODAL DE RELATÓRIO DE PROGRESSO */}
      {showRelatorioModal && alunoAtual && (() => {
        const dados = getDadosProgressoAluno(alunoAtual);
        if (!dados) return null;

        return (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: '20px'
          }}>
            <style>{`
              @media print {
                body * {
                  visibility: hidden !important;
                }
                #relatorio-print-area, #relatorio-print-area * {
                  visibility: visible !important;
                }
                #relatorio-print-area {
                  position: absolute !important;
                  left: 0 !important;
                  top: 0 !important;
                  width: 100% !important;
                  background: #ffffff !important;
                  color: #000000 !important;
                  padding: 20px !important;
                  box-shadow: none !important;
                }
                .no-print {
                  display: none !important;
                }
              }
            `}</style>

            <div style={{
              background: 'var(--bg-card)', width: '100%', maxWidth: '950px', maxHeight: '90vh',
              borderRadius: '16px', border: '1px solid var(--border-light)', overflow: 'hidden',
              display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)'
            }}>
              {/* Barra de Ações Topo (no-print) */}
              <div className="no-print" style={{
                padding: '16px 24px', borderBottom: '1px solid var(--border-medium)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'var(--bg-main)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ background: '#2563eb', padding: '8px', borderRadius: '8px', color: '#fff', display: 'flex' }}>
                    <TrendingUp size={22} />
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Relatório de Progresso de Cargas
                    </h2>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Acompanhamento completo desde o primeiro treino para os pais
                    </p>
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button
                    onClick={() => gerarPdfRelatorio(alunoAtual, dados)}
                    className="premium-btn-outline"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', padding: '8px 14px' }}
                  >
                    <Download size={16} /> Baixar PDF
                  </button>

                  <button
                    onClick={() => window.print()}
                    className="premium-btn"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', padding: '8px 14px', background: '#2563eb' }}
                  >
                    <Printer size={16} /> Imprimir
                  </button>

                  <button
                    onClick={() => setShowRelatorioModal(false)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '6px' }}
                  >
                    <X size={24} />
                  </button>
                </div>
              </div>

              {/* Conteúdo Imprimível do Relatório */}
              <div id="relatorio-print-area" style={{ padding: '30px', overflowY: 'auto', flex: 1, background: 'var(--bg-card)' }}>
                {/* Cabeçalho do Aluno */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '20px',
                  padding: '24px', borderRadius: '12px', background: 'linear-gradient(135deg, rgba(37,99,235,0.08) 0%, rgba(59,130,246,0.02) 100%)',
                  border: '1px solid rgba(37,99,235,0.2)', marginBottom: '24px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {alunoAtual.foto ? (
                      <img src={alunoAtual.foto} alt={alunoAtual.nome} style={{ width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #2563eb' }} />
                    ) : (
                      <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', fontWeight: 'bold' }}>
                        {alunoAtual.nome.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <h1 style={{ margin: '0 0 4px 0', fontSize: '1.6rem', color: 'var(--text-primary)' }}>{alunoAtual.nome}</h1>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        <span>📅 1º Treino: <strong>{dados.dataPrimeiroTreino}</strong></span>
                        <span>⚡ Fase Atual: <strong>{dados.faseAtual}</strong></span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '16px' }}>
                    <div style={{ padding: '10px 16px', background: 'var(--bg-main)', borderRadius: '10px', textAlign: 'center', border: '1px solid var(--border-light)' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#2563eb' }}>{dados.totalPresencas}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>TREINOS CONCLUÍDOS</div>
                    </div>
                    <div style={{ padding: '10px 16px', background: 'var(--bg-main)', borderRadius: '10px', textAlign: 'center', border: '1px solid var(--border-light)' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10b981' }}>{dados.totalFichas}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>FICHAS/FASES</div>
                    </div>
                  </div>
                </div>

                {/* Destaques de Maior Evolução */}
                {dados.destaques.length > 0 && (
                  <div style={{ marginBottom: '28px' }}>
                    <h3 style={{ margin: '0 0 14px 0', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Sparkles size={20} style={{ color: '#eab308' }} /> Destaques de Evolução de Carga
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                      {dados.destaques.map((item, idx) => (
                        <div key={idx} style={{
                          padding: '16px', borderRadius: '12px', background: 'var(--bg-main)',
                          border: '1px solid var(--border-light)', position: 'relative', overflow: 'hidden'
                        }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                            {item.categoria}
                          </div>
                          <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '10px' }}>
                            {item.nomeExercicio}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>{item.cargaInicial}</span>
                            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#10b981' }}>{item.cargaAtual}</span>
                            {item.diffKg !== null && item.diffKg > 0 && (
                              <span style={{ marginLeft: 'auto', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 800 }}>
                                +{item.diffKg} kg {item.percentualGanha ? `(+${item.percentualGanha.toFixed(0)}%)` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tabela de Evolução Completa */}
                <div style={{ marginBottom: '28px' }}>
                  <h3 style={{ margin: '0 0 14px 0', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Dumbbell size={20} style={{ color: '#2563eb' }} /> Histórico de Cargas por Exercício
                  </h3>

                  {dados.itens.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Nenhum exercício com carga registrada ainda.</p>
                  ) : (
                    <div style={{ overflowX: 'auto', border: '1px solid var(--border-light)', borderRadius: '12px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-medium)', textAlign: 'left' }}>
                            <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 700 }}>EXERCÍCIO</th>
                            <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 700 }}>1ª FICHA ({dados.dataPrimeiroTreino})</th>
                            <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 700 }}>FICHA ATUAL</th>
                            <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 700 }}>EVOLUÇÃO</th>
                            <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 700 }}>LINHA DO TEMPO</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dados.itens.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: idx < dados.itens.length - 1 ? '1px solid var(--border-light)' : 'none', background: idx % 2 === 0 ? 'transparent' : 'var(--bg-main)' }}>
                              <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                {item.nomeExercicio}
                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>{item.categoria}</span>
                              </td>
                              <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                                <span style={{ background: 'var(--bg-main)', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-light)', fontWeight: 600 }}>
                                  {item.cargaInicial}
                                </span>
                              </td>
                              <td style={{ padding: '12px 16px', color: 'var(--text-primary)', fontWeight: 700 }}>
                                <span style={{ background: 'rgba(37,99,235,0.1)', color: '#2563eb', padding: '4px 8px', borderRadius: '6px', fontWeight: 700 }}>
                                  {item.cargaAtual}
                                </span>
                              </td>
                              <td style={{ padding: '12px 16px' }}>
                                {item.diffKg !== null ? (
                                  <span style={{
                                    fontWeight: 800, fontSize: '0.85rem', padding: '3px 8px', borderRadius: '12px',
                                    background: item.diffKg > 0 ? '#dcfce7' : item.diffKg < 0 ? '#fee2e2' : 'var(--bg-main)',
                                    color: item.diffKg > 0 ? '#15803d' : item.diffKg < 0 ? '#b91c1c' : 'var(--text-muted)'
                                  }}>
                                    {item.diffKg > 0 ? `+${item.diffKg} kg` : `${item.diffKg} kg`}
                                    {item.percentualGanha !== null && item.percentualGanha > 0 ? ` (+${item.percentualGanha.toFixed(0)}%)` : ''}
                                  </span>
                                ) : item.cargaInicial !== item.cargaAtual ? (
                                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#2563eb' }}>
                                    {item.cargaInicial} ➔ {item.cargaAtual}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Estável</span>
                                )}
                              </td>
                              <td style={{ padding: '12px 16px' }}>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                                  {item.historicoVersoes.map((h, hIdx) => (
                                    <span key={hIdx} style={{
                                      fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px',
                                      background: 'var(--bg-main)', border: '1px solid var(--border-medium)',
                                      color: 'var(--text-secondary)'
                                    }}>
                                      <strong>{h.faseLabel.split(' ')[0]}:</strong> {h.carga}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Rodapé Profissional para Impressão */}
                <div style={{
                  marginTop: '30px', paddingTop: '16px', borderTop: '1px solid var(--border-medium)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: '0.8rem', color: 'var(--text-muted)'
                }}>
                  <div>Acompanhamento Individual de Cargas • Studio de Treinamento</div>
                  <div>Relatório gerado em {new Date().toLocaleDateString('pt-BR')}</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL NOVO ALUNO */}
      {showNovoAlunoModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '20px'
        }}>
          <div style={{
            background: 'var(--bg-card)', borderRadius: '16px',
            border: '1px solid var(--border-medium)', padding: '28px',
            maxWidth: '450px', width: '100%', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '6px', color: 'var(--text-primary)' }}>
              Cadastrar Novo Aluno
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Digite o nome do aluno e defina se é um treino introdutório.
            </p>

            <form onSubmit={confirmarCriarAluno}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px' }}>
                  NOME DO ALUNO
                </label>
                <input
                  type="text"
                  autoFocus
                  value={novoAlunoNome}
                  onChange={(e) => setNovoAlunoNome(e.target.value)}
                  placeholder="Ex: João Santos"
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: '8px',
                    border: '1px solid var(--border-medium)', background: 'var(--bg-main)',
                    color: 'var(--text-primary)', fontSize: '1rem', outline: 'none'
                  }}
                />
              </div>

              <div style={{
                background: 'var(--bg-main)', padding: '14px 16px', borderRadius: '10px',
                border: '1px solid var(--border-light)', marginBottom: '24px'
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={novoAlunoIntrodutorio}
                    onChange={(e) => setNovoAlunoIntrodutorio(e.target.checked)}
                    style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#2563eb' }}
                  />
                  <div>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block' }}>
                      Treino Introdutório
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#2563eb', fontWeight: 600 }}>
                      Exibirá "Introdutório" em azul na Tela da TV
                    </span>
                  </div>
                </label>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowNovoAlunoModal(false)}
                  style={{
                    padding: '10px 18px', borderRadius: '8px', border: '1px solid var(--border-medium)',
                    background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="premium-btn"
                  style={{ padding: '10px 20px', fontWeight: 700 }}
                >
                  Criar Ficha do Aluno
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL EDITAR NOME DO ALUNO */}
      {showEditarNomeModal && alunoAtual && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '20px'
        }}>
          <div style={{
            background: 'var(--bg-card)', borderRadius: '16px',
            border: '1px solid var(--border-medium)', padding: '28px',
            maxWidth: '450px', width: '100%', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '6px', color: 'var(--text-primary)' }}>
              Editar Nome do Aluno
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Altere a grafia do nome do aluno caso tenha sido digitado incorretamente.
            </p>

            <form onSubmit={confirmarEditarNome}>
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px' }}>
                  NOME DO ALUNO
                </label>
                <input
                  type="text"
                  autoFocus
                  value={editarNomeValue}
                  onChange={(e) => setEditarNomeValue(e.target.value)}
                  placeholder="Digite o nome correto..."
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: '8px',
                    border: '1px solid var(--border-medium)', background: 'var(--bg-main)',
                    color: 'var(--text-primary)', fontSize: '1rem', outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowEditarNomeModal(false)}
                  style={{
                    padding: '10px 18px', borderRadius: '8px', border: '1px solid var(--border-medium)',
                    background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="premium-btn"
                  style={{ padding: '10px 20px', fontWeight: 700 }}
                >
                  Salvar Nome
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
