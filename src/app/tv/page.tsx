"use client";
import React, { useState, useEffect, useRef } from "react";
import { mockDb, Aluno, Exercicio, Treino } from "@/lib/mockData";
import { Dumbbell } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

export default function TVPage() {
  const [alunosAtivos, setAlunosAtivos] = useState<(Aluno & { treinoAtualId: string })[]>([]);
  const isEditingRef = useRef(false);
  const [zoom, setZoom] = useState<number>(100);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tv_screen_zoom");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 70 && parsed <= 200) {
          setZoom(parsed);
        }
      }
    }
  }, []);

  const handleZoomChange = (newZoom: number) => {
    const clamped = Math.min(200, Math.max(70, newZoom));
    setZoom(clamped);
    if (typeof window !== "undefined") {
      localStorage.setItem("tv_screen_zoom", clamped.toString());
    }
  };

  const carregarDados = async () => {
    const session = await mockDb.getTvSession();
    const activeIds = session.map(s => s.alunoId);
    
    if (activeIds.length === 0) {
      setAlunosAtivos([]);
      return;
    }

    const alunosAtivosDb = await mockDb.getAlunosByIds(activeIds);
    
    const ativos = session.map(s => {
      const dbAluno = alunosAtivosDb.find(a => a.id === s.alunoId);
      if(dbAluno) {
        return { ...dbAluno, treinoAtualId: s.treinoAtivoId };
      }
      return null;
    }).filter(Boolean) as (Aluno & { treinoAtualId: string })[];

    setAlunosAtivos(ativos);
  };

  useEffect(() => {
    carregarDados();

    // Inscrever em mudanças em tempo real no Supabase
    const channelAlunos = supabase
      .channel('tv-alunos-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'alunos' },
        () => {
          if (!isEditingRef.current) {
            carregarDados();
          }
        }
      )
      .subscribe();

    const channelSession = supabase
      .channel('tv-session-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tv_session' },
        () => {
          if (!isEditingRef.current) {
            carregarDados();
          }
        }
      )
      .subscribe();

    // Polling contínuo para backup caso a conexão em tempo real caia ou não esteja habilitada
    const interval = setInterval(() => {
      if (!isEditingRef.current) {
        carregarDados();
      }
    }, 60000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channelAlunos);
      supabase.removeChannel(channelSession);
    };
  }, []);

  const handleFocus = () => {
    isEditingRef.current = true;
  };

  const handleLocalChange = (alunoId: string, treinoId: string, exercicioId: string, campo: 'carga'|'reps'|'series'|'nome'|'intervalo', valor: string) => {
    setAlunosAtivos(prev => prev.map(aluno => {
      if (aluno.id !== alunoId) return aluno;
      return {
        ...aluno,
        treinos: aluno.treinos.map(treino => {
          if (treino.id !== treinoId) return treino;
          return {
            ...treino,
            exercicios: treino.exercicios.map(ex => {
              if (ex.id !== exercicioId) return ex;
              return { ...ex, [campo]: valor };
            })
          };
        })
      };
    }));
  };

  const handleBlurSave = async (alunoId: string, treinoId: string, exercicioId: string, campo: 'carga'|'reps'|'series'|'nome'|'intervalo', valor: string) => {
    isEditingRef.current = false;
    await mockDb.updateCampoExercicio(alunoId, treinoId, exercicioId, campo, valor);
  };

  const handleCmjChange = (alunoId: string, valor: string) => {
    setAlunosAtivos(prev => prev.map(aluno => {
      if (aluno.id !== alunoId) return aluno;
      return { ...aluno, alturaCmj: valor };
    }));
  };

  const handleCmjBlurSave = async (alunoId: string, valor: string) => {
    isEditingRef.current = false;
    await mockDb.updateAlturaCmj(alunoId, valor);
  };

  const handleNomeChange = (alunoId: string, valor: string) => {
    setAlunosAtivos(prev => prev.map(aluno => {
      if (aluno.id !== alunoId) return aluno;
      return { ...aluno, nome: valor };
    }));
  };

  const handleNomeBlurSave = async (alunoId: string, valor: string) => {
    isEditingRef.current = false;
    await mockDb.updateNomeAluno(alunoId, valor);
  };

  const renderZoomControl = () => (
    <div
      style={{
        position: 'fixed',
        top: '12px',
        right: '16px',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(26, 23, 44, 0.92)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '8px',
        padding: '5px 12px',
        gap: '12px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        onClick={() => handleZoomChange(zoom - 5)}
        disabled={zoom <= 70}
        title="Diminuir zoom (-5%)"
        style={{
          background: 'transparent',
          border: 'none',
          color: zoom <= 70 ? 'rgba(255, 255, 255, 0.3)' : '#ffffff',
          cursor: zoom <= 70 ? 'not-allowed' : 'pointer',
          fontSize: '1.1rem',
          fontWeight: 700,
          lineHeight: 1,
          padding: '2px 6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (zoom > 70) (e.currentTarget.style.color = '#38bdf8');
        }}
        onMouseLeave={(e) => {
          if (zoom > 70) (e.currentTarget.style.color = '#ffffff');
        }}
      >
        −
      </button>

      <span
        onClick={() => handleZoomChange(100)}
        title="Clique para redefinir para 100%"
        style={{
          fontSize: '0.9rem',
          fontWeight: 800,
          color: '#ffffff',
          minWidth: '44px',
          textAlign: 'center',
          cursor: 'pointer',
          letterSpacing: '0.5px',
        }}
      >
        {zoom}%
      </span>

      <button
        type="button"
        onClick={() => handleZoomChange(zoom + 5)}
        disabled={zoom >= 200}
        title="Aumentar zoom (+5%)"
        style={{
          background: 'transparent',
          border: 'none',
          color: zoom >= 200 ? 'rgba(255, 255, 255, 0.3)' : '#ffffff',
          cursor: zoom >= 200 ? 'not-allowed' : 'pointer',
          fontSize: '1.1rem',
          fontWeight: 700,
          lineHeight: 1,
          padding: '2px 6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (zoom < 200) (e.currentTarget.style.color = '#38bdf8');
        }}
        onMouseLeave={(e) => {
          if (zoom < 200) (e.currentTarget.style.color = '#ffffff');
        }}
      >
        +
      </button>
    </div>
  );

  // Se não tem ninguém
  if (alunosAtivos.length === 0) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-main)',
        position: 'relative',
      }}>
        {renderZoomControl()}
        <Dumbbell size={80} color="var(--border-medium)" />
        <h1 style={{ color: 'var(--text-secondary)', marginTop: '20px' }}>Rumpel Training</h1>
        <p style={{ color: 'var(--text-muted)' }}>Aguardando o professor enviar os treinos...</p>
      </div>
    );
  }

  // Dinâmica de Grid para TV
  const numAlunos = alunosAtivos.length;
  const cols = numAlunos > 8 ? 8 : (numAlunos === 0 ? 1 : numAlunos);
  
  let scale = 1;
  if (cols <= 2) scale = 1.35;
  else if (cols === 3) scale = 1.25;
  else if (cols === 4) scale = 1.15;
  else if (cols <= 6) scale = 1.05;
  else scale = 1;

  const s = (val: number) => `${(val * scale).toFixed(2)}rem`;
  const px = (val: number) => `${Math.round(val * scale)}px`;

  const renderExercicioRow = (aluno: Aluno & { treinoAtualId: string }, treino: Treino, ex: Exercicio, badgeColor: string, isLast: boolean) => (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: `${px(2)} 0`,
      borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
    }}>
      <div style={{ flex: 1, paddingRight: px(4), display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ marginBottom: px(1) }}>
          <span style={{
            fontSize: s(0.6), textTransform: 'uppercase', fontWeight: 700,
            color: badgeColor, border: `1px solid ${badgeColor}`,
            padding: `0 ${px(3)}`, borderRadius: px(3)
          }}>
            {ex.categoria.toUpperCase() === 'FORCA' ? 'FORÇA' : ex.categoria.toUpperCase() === 'POTENCIA' ? 'POTÊNCIA' : ex.categoria}
          </span>
        </div>
        <input
          value={ex.nome}
          onFocus={handleFocus}
          onChange={(e) => handleLocalChange(aluno.id, treino.id, ex.id, 'nome', e.target.value)}
          onBlur={(e) => handleBlurSave(aluno.id, treino.id, ex.id, 'nome', e.target.value)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontSize: s(0.75),
            fontWeight: 600,
            lineHeight: 1.1,
            textTransform: 'uppercase',
            letterSpacing: '-0.5px',
            outline: 'none',
            width: '100%',
            padding: 0
          }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: px(165) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: px(2), marginBottom: px(1) }}>
          <span style={{ fontSize: s(0.6), fontWeight: 600, color: 'var(--text-secondary)' }}>Séries</span>
          <input
            value={ex.series}
            onFocus={handleFocus}
            onChange={(e) => handleLocalChange(aluno.id, treino.id, ex.id, 'series', e.target.value)}
            onBlur={(e) => handleBlurSave(aluno.id, treino.id, ex.id, 'series', e.target.value)}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-primary)',
              fontSize: s(0.75), fontWeight: 700, width: px(25), textAlign: 'right', outline: 'none'
            }}
          />
        </div>
        <div style={{
          display: 'flex',
          background: '#f3f4f6',
          border: '1px solid #e5e7eb',
          padding: `${px(1)} ${px(3)}`,
          borderRadius: px(5),
          width: '100%',
          justifyContent: 'space-around',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: s(0.45), color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>CARGA</span>
            <input
              value={ex.carga}
              onFocus={handleFocus}
              onChange={(e) => handleLocalChange(aluno.id, treino.id, ex.id, 'carga', e.target.value)}
              onBlur={(e) => handleBlurSave(aluno.id, treino.id, ex.id, 'carga', e.target.value)}
              style={{
                background: 'transparent', border: 'none', color: 'var(--accent-primary)',
                fontSize: s(0.8), fontWeight: 700, textAlign: 'center',
                width: px(54), outline: 'none'
              }}
              placeholder="-"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: s(0.45), color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
              {(ex.categoria || '').toUpperCase() === 'ISOMETRIA' ? 'TEMPO' : 'REPS'}
            </span>
            <input
              value={ex.reps}
              onFocus={handleFocus}
              onChange={(e) => handleLocalChange(aluno.id, treino.id, ex.id, 'reps', e.target.value)}
              onBlur={(e) => handleBlurSave(aluno.id, treino.id, ex.id, 'reps', e.target.value)}
              style={{
                background: 'transparent', border: 'none', color: 'var(--accent-primary)',
                fontSize: s(0.8), fontWeight: 700, textAlign: 'center',
                width: px(44), outline: 'none'
              }}
              placeholder="-"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: s(0.45), color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>INT.</span>
            <input
              value={ex.intervalo ?? ''}
              onFocus={handleFocus}
              onChange={(e) => handleLocalChange(aluno.id, treino.id, ex.id, 'intervalo', e.target.value)}
              onBlur={(e) => handleBlurSave(aluno.id, treino.id, ex.id, 'intervalo', e.target.value)}
              style={{
                background: 'transparent', border: 'none', color: 'var(--accent-primary)',
                fontSize: s(0.8), fontWeight: 700, textAlign: 'center',
                width: px(44), outline: 'none'
              }}
              placeholder="-"
            />
          </div>

        </div>
      </div>
    </div>
  );

  const renderExercicios = (aluno: Aluno & { treinoAtualId: string }, treino: Treino) => {
    const getBlockLimits = (t: any): number[] => {
      if (t.limitesBlocos !== undefined) {
        return t.limitesBlocos;
      }
      if (t.bloco2Desativado) {
        return [];
      }

      const getLegacyBlockLimits = (treino: any): number[] => {
        if (treino.bloco2Desativado) {
          return [];
        }
        const forcaIndices: number[] = [];
        treino.exercicios.forEach((ex: any, idx: number) => {
          const cat = (ex.categoria || '').toUpperCase();
          if (cat.includes('FORC') || cat.includes('FORÇ')) {
            forcaIndices.push(idx + 1);
          }
        });
        if (forcaIndices.length === 0) {
          return [];
        }
        const limit1Forca = treino.limiteBloco1 !== undefined ? treino.limiteBloco1 : 3;
        const bloco3Desativado = treino.bloco3Desativado !== false;
        const limit1Index = forcaIndices[Math.min(limit1Forca, forcaIndices.length) - 1];
        if (bloco3Desativado) {
          return [limit1Index];
        }
        const limit2Forca = treino.limiteBloco2 !== undefined ? treino.limiteBloco2 : (limit1Forca + 3);
        const limit2Index = forcaIndices[Math.min(limit2Forca, forcaIndices.length) - 1];
        return [limit1Index, limit2Index];
      };

      const isComplex = t.exercicios.some((ex: any, i: number, arr: any[]) => {
        const isPot = (ex.categoria || '').toUpperCase().includes('POTENCIA') || (ex.categoria || '').toUpperCase().includes('POTÊNCIA');
        if (!isPot) return false;
        return arr.slice(0, i).some(prev => (prev.categoria || '').toUpperCase().includes('FORC') || (prev.categoria || '').toUpperCase().includes('FORÇ'));
      });

      const limits: number[] = [];
      let forcaCounter = 0;
      let complexBlockCounter = 0;
      
      t.exercicios.forEach((ex: any, exIdx: number) => {
        const upperCat = (ex.categoria || '').toUpperCase();
        const isForca = upperCat.includes('FORC') || upperCat.includes('FORÇ');
        
        if (isForca) {
          forcaCounter++;
          if (isComplex) {
            const prevEx = exIdx > 0 ? t.exercicios[exIdx - 1] : null;
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
              const legacyLimits = getLegacyBlockLimits(t);
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

    const limits = getBlockLimits(treino);

    const getBadgeColor = (categoria: string) => {
      const catUpper = (categoria || '').toUpperCase();
      if (catUpper.includes('CORE')) return 'var(--cat-core)';
      if (catUpper.includes('POTEN') || catUpper.includes('POTÊNCIA')) return 'var(--cat-explosao)';
      if (catUpper.includes('FORC') || catUpper.includes('FORÇ')) return 'var(--cat-forca)';
      if (catUpper.includes('ISOMETRI') || catUpper.includes('ISOMETRIA')) return '#0284c7';
      if (catUpper.includes('ACC') || catUpper.includes('DCC') || catUpper.includes('OSC') || catUpper.includes('AFSM')) return 'var(--cat-forca)';
      return 'var(--text-secondary)';
    };

    const groups: { label: string | null, exercises: Exercicio[] }[] = [];
    let currentGroup: { label: string | null, exercises: Exercicio[] } = { label: null, exercises: [] };
    
    let exerciseCounter = 0;

    treino.exercicios.forEach((ex, exIdx, arr) => {
      exerciseCounter++;
      let startNewBlock = false;
      let newBlockLabel = '';

      const matchIdx = limits.indexOf(exerciseCounter - 1);
      if (matchIdx !== -1) {
        startNewBlock = true;
        newBlockLabel = `BLOCO ${matchIdx + 1}`;
      }

      if (startNewBlock) {
        if (currentGroup.exercises.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = { label: newBlockLabel, exercises: [ex] };
      } else {
        currentGroup.exercises.push(ex);
      }
    });

    if (currentGroup.exercises.length > 0) {
      groups.push(currentGroup);
    }

    return (
      <>
        {groups.map((group, gIdx) => {
          if (!group.label) {
            return group.exercises.map(ex => {
              const badgeColor = getBadgeColor(ex.categoria);
              return (
                <div key={ex.id}>
                  {renderExercicioRow(aluno, treino, ex, badgeColor, false)}
                </div>
              );
            });
          }

          return (
            <div key={`group-${gIdx}`} style={{ border: `${px(1.5)} solid var(--accent-primary)`, borderRadius: px(8), padding: `${px(4)} ${px(6)}`, marginTop: px(4) }}>
              <div style={{ fontSize: s(0.7), fontWeight: 900, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: px(2) }}>
                {group.label}
              </div>
              {group.exercises.map((ex, i) => {
                const badgeColor = getBadgeColor(ex.categoria);
                return (
                  <div key={ex.id}>
                    {renderExercicioRow(aluno, treino, ex, badgeColor, i === group.exercises.length - 1)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-main)',
      position: 'relative',
      overflowX: 'auto',
    }}>
      {renderZoomControl()}

      <div style={{
        zoom: `${zoom}%`,
        minHeight: '100vh',
        padding: px(4),
        background: 'var(--bg-main)',
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: px(4),
        alignItems: 'stretch',
      }}>
      {alunosAtivos.map(aluno => {
        const treino = aluno.treinos.find(t => t.id === aluno.treinoAtualId) || aluno.treinos[0];
        if (!treino) return null;

        return (
          <div key={aluno.id} style={{
            background: 'var(--bg-card)',
            borderRadius: px(16),
            border: '1px solid var(--border-light)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            maxWidth: `${Math.round(450 * scale)}px`,
            margin: '0 auto'
          }}>
            {/* Header do Card */}
            <div style={{
              background: '#ffffff',
              padding: px(4),
              borderBottom: `${px(3)} solid var(--accent-primary)`,
              textAlign: 'center',
              position: 'relative'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: px(4), flexWrap: 'wrap' }}>
                <input
                  value={aluno.nome ? aluno.nome.toUpperCase() : ''}
                  onFocus={handleFocus}
                  onChange={(e) => handleNomeChange(aluno.id, e.target.value)}
                  onBlur={(e) => handleNomeBlurSave(aluno.id, e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-primary)',
                    fontSize: s(0.9),
                    fontWeight: 600,
                    textAlign: 'center',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    outline: 'none',
                    width: 'auto',
                    maxWidth: '100%',
                    padding: 0,
                    margin: 0,
                    cursor: 'pointer'
                  }}
                />
                {aluno.isIntrodutorio && (
                  <span style={{
                    color: '#2563eb',
                    fontSize: s(0.75),
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                    whiteSpace: 'nowrap'
                  }}>
                    Introdutório
                  </span>
                )}
              </div>
              <div style={{
                display: 'inline-block', background: 'var(--accent-primary)',
                color: 'white', padding: `${px(1)} ${px(4)}`, borderRadius: px(4),
                fontSize: s(0.6), fontWeight: 600, marginTop: px(2)
              }}>
                {treino.nomeTreino}
              </div>
            </div>

            {/* Lista de Exercicios */}
            <div style={{ padding: `${px(4)} ${px(8)}`, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {renderExercicios(aluno, treino)}

              {/* CMJ Highlight no final (Editável) */}
              {aluno.alturaCmj && aluno.alturaCmj.trim() !== '' && (
                <div style={{
                  marginTop: px(12),
                  marginBottom: px(8),
                  display: 'flex',
                  justifyContent: 'center'
                }}>
                  <div style={{
                    background: 'var(--cat-explosao)',
                    color: 'white',
                    padding: `${px(4)} ${px(12)}`,
                    borderRadius: px(8),
                    fontSize: s(0.95),
                    fontWeight: 900,
                    textTransform: 'uppercase',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    letterSpacing: '1px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: px(1)
                  }}>
                    <span>CMJ:</span>
                    <input
                      value={aluno.alturaCmj || ''}
                      placeholder="-"
                      onFocus={handleFocus}
                      onChange={(e) => handleCmjChange(aluno.id, e.target.value)}
                      onBlur={(e) => handleCmjBlurSave(aluno.id, e.target.value)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'white',
                        fontSize: s(0.95),
                        fontWeight: 900,
                        width: px(50),
                        textAlign: 'center',
                        outline: 'none',
                        borderBottom: '1px dashed rgba(255, 255, 255, 0.6)',
                        padding: 0
                      }}
                    />
                    <span>cm</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
      </div>

      {/* Rumpel Training Watermark */}
      <div style={{ position: 'fixed', bottom: '15px', right: '20px', color: 'var(--text-secondary)', opacity: 0.15, fontSize: '1.4rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'none', zIndex: 100 }}>
        <Dumbbell size={24} color="var(--accent-primary)" />
        <span>RUMPEL <span style={{ color: 'var(--accent-primary)' }}>TRAINING</span></span>
      </div>
    </div>
  );
}
