// ATENÇÃO: ROTA AJUSTADA PARA O SERVIDOR NODE.JS DO USUÁRIO.
// A constante API agora usa o prefixo /api/ que corresponde às rotas do server.js.
const API = e => `/api/${e}`; 

const TIME_SLOTS = [
  { id:'M1', start:'07:30' }, { id:'M2', start:'08:20' }, { id:'M3', start:'09:10' },
  { id:'M4', start:'10:20' }, { id:'M5', start:'11:10' }, { id:'M6', start:'12:00' },
  { id:'T1', start:'13:00' }, { id:'T2', start:'13:50' }, { id:'T3', start:'14:40' },
  { id:'T4', start:'15:50' }, { id:'T5', start:'16:40' }, { id:'T6', start:'17:50' },
  { id:'N1', start:'18:40' }, { id:'N2', start:'19:30' }, { id:'N3', start:'20:20' },
  { id:'N4', start:'21:20' }, { id:'N5', start:'22:10' }, { id:'EAD', start:'23:00' }
];

const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const dados = {
  disciplinas:[],
  professores:[],
  horarios:[],
  salas:[] // <-- DADO DE SALAS
};

// --- ESTADO DA GRADE (Drag & Drop e C/V) ---
let draggedIndex = null;
let clipboardHorarioIndex = null; // Armazena o ÍNDICE do horário copiado
let clipboardTarget = { dia: null, slot: null }; // Armazena a CÉLULA clicada (para colar)
let selectionMode = 'none'; // 'item' ou 'cell'

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    // Verifica se o toast existe antes de tentar usá-lo
    if (toast) {
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        setTimeout(() => {
            toast.className = toast.className.replace('show', '');
        }, 3000);
    } else {
        // Fallback se o #toast não estiver no HTML
        console.warn('Elemento #toast não encontrado. Mensagem:', message);
    }
}

// --- Funções de Arrastar e Soltar (Drag & Drop) ---

function dragStart(event, index) {
    draggedIndex = index;
    const item = event.target;
    // Verifica se 'item' e 'classList' existem
    if (item && item.classList) {
        item.classList.add('dragging');
    }
    // Armazena o índice do horário sendo arrastado
    event.dataTransfer.setData('text/plain', index); 
}

function dragEnd(event) {
    const item = event.target;
    // Verifica se 'item' e 'classList' existem
    if (item && item.classList) {
        item.classList.remove('dragging');
    }
    draggedIndex = null;
}

function allowDrop(event) {
    event.preventDefault(); // Permite soltar
    
    // Feedback visual ao passar por uma célula válida
    const cell = event.target.closest('td.drop-target');
    if (cell) {
        cell.classList.add('drag-over');
    }
}

function dragLeave(event) {
    // Remove o feedback visual ao sair da célula
    const cell = event.target.closest('td.drop-target');
    if (cell) {
        cell.classList.remove('drag-over');
    }
}

function drop(event) {
    event.preventDefault();
    const cell = event.target.closest('td.drop-target');
    if (!cell) {
        console.warn('Drop em local inválido.');
        return;
    }
    cell.classList.remove('drag-over'); // Limpa o feedback

    if (draggedIndex === null) return; // Se nada estiver sendo arrastado, pare

    const newDia = cell.dataset.dia;
    const newSlot = cell.dataset.slot;

    // 1. Obter o horário original que está sendo movido
    const horarioMovido = dados.horarios[draggedIndex];
    if (!horarioMovido) {
        console.error("Erro: Horário arrastado não encontrado.");
        draggedIndex = null;
        return;
    }

    // 2. Extrair dados para verificação de conflito
    const professorArrastado = horarioMovido.professor;
    const salaArrastada = horarioMovido.sala;
    const codigoArrastado = horarioMovido.disciplina.split(' - ')[0]; // Pega o código (ex: 'SI301')

    // 3. Encontrar a disciplina correspondente para obter curso/período
    const discObj = dados.disciplinas.find(d => d.codigo === codigoArrastado);
    if (!discObj) {
        console.error("Erro: Disciplina do horário arrastado não encontrada.");
        draggedIndex = null;
        return;
    }
    const cursoArrastado = discObj.curso;
    const periodoArrastado = discObj.periodo;

    // 4. VERIFICAÇÕES DE CONFLITO (Ignorando o próprio item sendo movido)

    // A. Conflito de Professor
    const conflitoProfessor = findConflitoProfessor(newDia, newSlot, professorArrastado, draggedIndex);
    if (conflitoProfessor) {
        showToast(`Conflito! Professor ${professorArrastado} já alocado em ${newDia} - ${newSlot}.`, 'error');
        draggedIndex = null;
        return;
    }

    // B. Conflito de Sala
    const conflitoSala = findConflitoSala(newDia, newSlot, salaArrastada, draggedIndex);
    if (conflitoSala) {
        showToast(`Conflito! Sala ${salaArrastada} já ocupada em ${newDia} - ${newSlot}.`, 'error');
        draggedIndex = null;
        return;
    }

    // C. Conflito de Grade (Curso/Período)
    // *** ALTERAÇÃO AQUI: Passa o 'codigoArrastado' ***
    const conflitoCursoPeriodo = findConflitoCursoPeriodo(newDia, newSlot, cursoArrastado, periodoArrastado, codigoArrastado, draggedIndex);
    if (conflitoCursoPeriodo) {
        const discConflitante = conflitoCursoPeriodo.disciplina.split(' - ')[0];
        showToast(`Conflito de Grade! ${cursoArrastado} (${periodoArrastado}ºP) já tem a disciplina ${discConflitante} em ${newDia} - ${newSlot}.`, 'error');
        draggedIndex = null;
        return;
    }

    // 5. Se não houver conflitos, atualize o horário
    horarioMovido.dia = newDia;
    horarioMovido.slot = newSlot;

    // 6. Salvar e Re-renderizar
    salvar('horarios');
    renderGrade(); // Re-renderiza a grade principal
    showToast('Horário movido com sucesso!', 'success');

    // Limpa o estado
    draggedIndex = null;
}

// --- Funções de Copiar e Colar (C/V) ---

function selectHorarioItem(event, index) {
    event.stopPropagation(); // Impede que o clique selecione a célula (selectCell)

    // Remove a seleção anterior (seja de item ou de célula)
    clearSelection();

    // Define o novo estado de seleção
    selectionMode = 'item';
    clipboardHorarioIndex = index; // Armazena o índice do item clicado

    // Adiciona feedback visual ao item
    const item = event.currentTarget;
    if (item && item.classList) {
        item.classList.add('selected');
    }

    // Limpa o alvo de colagem (pois estamos selecionando um item, não uma célula)
    clipboardTarget = { dia: null, slot: null }; 
}

function selectCell(event) {
    const cell = event.currentTarget;
    if (!cell) return;

    // Se clicarmos na mesma célula que já é o alvo, não faz nada
    if (cell.classList.contains('target-cell')) {
        return;
    }

    // Remove a seleção anterior (seja de item ou de célula)
    clearSelection();

    // Define o novo estado de seleção
    selectionMode = 'cell';
    // Armazena o alvo (dia/slot) da célula clicada
    clipboardTarget = { dia: cell.dataset.dia, slot: cell.dataset.slot }; 

    // Adiciona feedback visual à célula
    cell.classList.add('target-cell');

    // Se já tivermos algo no clipboard, tentamos colar imediatamente
    if (clipboardHorarioIndex !== null) {
        pasteHorario();
    }
}

function clearSelection() {
    // Remove seleção de todos os itens
    document.querySelectorAll('.horario-item.selected').forEach(el => el.classList.remove('selected'));
    
    // Remove seleção de todas as células
    document.querySelectorAll('td.target-cell').forEach(el => el.classList.remove('target-cell'));

    // Reseta o modo (mas não o clipboardHorarioIndex, que guarda o que foi copiado)
    selectionMode = 'none';
    clipboardTarget = { dia: null, slot: null };
}

function copyHorario() {
    // Se o modo for 'item' e tivermos um índice, o item está "copiado".
    // Apenas damos um feedback.
    if (selectionMode === 'item' && clipboardHorarioIndex !== null) {
        showToast('Horário copiado! Selecione uma célula vazia e pressione Ctrl+V.', 'success');
    }
}

function pasteHorario() {
    // Verifica se temos:
    // 1. Um horário copiado (clipboardHorarioIndex não é nulo)
    // 2. Um alvo válido (clipboardTarget.dia não é nulo)
    if (clipboardHorarioIndex === null || clipboardTarget.dia === null) {
        return;
    }

    const newDia = clipboardTarget.dia;
    const newSlot = clipboardTarget.slot;

    // 1. Obter o horário original que foi copiado
    const horarioCopiado = dados.horarios[clipboardHorarioIndex];
    if (!horarioCopiado) {
        console.error("Erro: Horário copiado não encontrado.");
        return;
    }

    // 2. Extrair dados para verificação de conflito
    const professor = horarioCopiado.professor;
    const sala = horarioCopiado.sala;
    const codigoDisciplina = horarioCopiado.disciplina.split(' - ')[0];

    // 3. Encontrar a disciplina correspondente
    const discObj = dados.disciplinas.find(d => d.codigo === codigoDisciplina);
    if (!discObj) {
        console.error("Erro: Disciplina do horário copiado não encontrada.");
        return;
    }
    const curso = discObj.curso;
    const periodo = discObj.periodo;

    // 4. VERIFICAÇÕES DE CONFLITO (ignorando o item copiado, índice -1)

    // A. Conflito de Professor
    const conflitoProfessor = findConflitoProfessor(newDia, newSlot, professor, -1);
    if (conflitoProfessor) {
        showToast(`Conflito! Professor ${professor} já alocado em ${newDia} - ${newSlot}.`, 'error');
        return;
    }

    // B. Conflito de Sala
    const conflitoSala = findConflitoSala(newDia, newSlot, sala, -1);
    if (conflitoSala) {
        showToast(`Conflito! Sala ${sala} já ocupada em ${newDia} - ${newSlot}.`, 'error');
        return;
    }

    // C. Conflito de Grade (Curso/Período)
    // *** ALTERAÇÃO AQUI: Passa o 'codigoDisciplina' ***
    const conflitoCursoPeriodo = findConflitoCursoPeriodo(newDia, newSlot, curso, periodo, codigoDisciplina, -1);
    if (conflitoCursoPeriodo) {
        const discConflitante = conflitoCursoPeriodo.disciplina.split(' - ')[0];
        showToast(`Conflito de Grade! ${curso} (${periodo}ºP) já tem a disciplina ${discConflitante} em ${newDia} - ${newSlot}.`, 'error');
        return;
    }

    // 5. Se não houver conflitos, ADICIONA um NOVO horário
    const novoHorario = {
        disciplina: horarioCopiado.disciplina,
        professor: horarioCopiado.professor,
        sala: horarioCopiado.sala,
        dia: newDia,
        slot: newSlot
    };

    dados.horarios.push(novoHorario);

    // 6. Salvar e Re-renderizar
    salvar('horarios');
    renderGrade(); // Re-renderiza a grade principal
    showToast('Horário colado com sucesso!', 'success');

    // 7. Limpa a seleção da célula-alvo
    clearSelection();
    // Mantém o clipboardHorarioIndex para colagens múltiplas
}

function deleteSelectedHorario() {
    if (selectionMode === 'item' && clipboardHorarioIndex !== null) {
        // Encontra o índice real (clipboardHorarioIndex é o índice do array 'dados.horarios')
        const indexToDelete = clipboardHorarioIndex;
        
        // Remove o horário
        dados.horarios.splice(indexToDelete, 1);
        
        // Salva e re-renderiza
        salvar('horarios');
        renderGrade();
        
        // Limpa estado
        clearSelection();
        clipboardHorarioIndex = null;
        
        showToast('Horário excluído com sucesso.', 'success');
    }
}

// --- Funções CRUD (Disciplinas, Professores, Salas) ---

async function carregarTudo() {
  try {
    const [disciplinas, professores, horarios, salas] = await Promise.all([
      fetch(API('disciplinas')).then(res => res.json()),
      fetch(API('professores')).then(res => res.json()),
      fetch(API('horarios')).then(res => res.json()),
      fetch(API('salas')).then(res => res.json()) // <-- Carrega Salas
    ]);
    dados.disciplinas = disciplinas;
    dados.professores = professores;
    dados.horarios = horarios;
    dados.salas = salas; // <-- Armazena Salas
    
    // Inicia a aplicação renderizando a grade por padrão
    renderMain('grade');
    
    // Preenche os filtros (que só existem na 'grade')
    preencherFiltros();

  } catch (error) {
    console.error("Erro ao carregar dados iniciais:", error);
    // Tenta renderizar mesmo com erro (pode ser offline)
    renderMain('grade');
  }
}

async function salvar(tipo) {
  try {
    const response = await fetch(API(tipo), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados[tipo])
    });
    if (!response.ok) {
      throw new Error(`Falha ao salvar ${tipo}`);
    }
    console.log(`${tipo} salvos com sucesso.`);
  } catch (error) {
    console.error(`Erro ao salvar ${tipo}:`, error);
    showToast(`Erro ao salvar ${tipo}. Verifique a conexão.`, 'error');
  }
}


function renderMain(sectionName){
  // CORREÇÃO: Procura por #conteudo (do index.html) em vez de 'main'
  const main = document.getElementById('conteudo');
  if (!main) {
      console.error("Elemento principal '#conteudo' não foi encontrado. A renderização falhará.");
      return;
  }

  // Limpa o estado de C/V ao mudar de aba
  clearSelection();
  clipboardHorarioIndex = null;
  
  // Oculta/Exibe o painel de filtros
  const filtroContainer = document.getElementById('filtro-container');
  
  // Verifica se o container de filtros existe antes de tentar manipulá-lo
  if (filtroContainer) { 
    if (sectionName === 'grade') {
        filtroContainer.style.display = 'block';
    } else {
        filtroContainer.style.display = 'none';
    }
  } else {
    // Se não existir, avisa no console (útil para debug)
    console.warn('Elemento #filtro-container não encontrado no DOM.');
  }

  // Delega a renderização para a função específica
  switch(sectionName) {
    case 'grade':
      renderGrade(); // A grade principal é renderizada dentro do 'main'
      break;
    case 'disciplinas':
      renderDisciplinas(main);
      break;
    case 'professores':
      renderProfessores(main);
      break;
    case 'salas':
      renderSalas(main);
      break;
    case 'horarios':
      renderHorarios(main);
      break;
    default:
      main.innerHTML = `<h2>Seção não encontrada: ${sectionName}</h2>`;
  }
}

function preencherFiltros() {
    const filtroCurso = document.getElementById('filtro-curso');
    const filtroPeriodo = document.getElementById('filtro-periodo');
    const filtroProfessor = document.getElementById('filtro-professor');

    // Cursos
    const cursos = [...new Set(dados.disciplinas.map(d => d.curso))].sort();
    // Adiciona verificação para caso o filtro não exista
    if (filtroCurso) {
        filtroCurso.innerHTML = '<option value="">Todos os Cursos</option>';
        cursos.forEach(curso => {
            filtroCurso.innerHTML += `<option value="${curso}">${curso}</option>`;
        });
    }

    // Períodos (Simples, ex: 1 a 10)
    const periodos = [...new Set(dados.disciplinas.map(d => parseInt(d.periodo)))].sort((a,b) => a-b);
    if (filtroPeriodo) {
        filtroPeriodo.innerHTML = '<option value="">Todos os Períodos</option>';
         periodos.forEach(periodo => {
            if (!isNaN(periodo)) { // Garante que é um número
                filtroPeriodo.innerHTML += `<option value="${periodo}">${periodo}º Período</option>`;
            }
        });
    }

    // Professores
    const professores = [...new Set(dados.professores.map(p => p.nome))].sort();
    if (filtroProfessor) {
        filtroProfessor.innerHTML = '<option value="">Todos os Professores</option>';
        professores.forEach(prof => {
            // Encontra o obj prof para pegar o departamento
            const profObj = dados.professores.find(p => p.nome === prof);
            // Garante que profObj foi encontrado
            if (profObj) {
                filtroProfessor.innerHTML += `<option value="${prof}">${profObj.departamento} - ${prof}</option>`;
            }
        });
    }
}

function aplicarFiltrosEConflictos() {
    renderGrade(); // A função renderGrade agora lê os filtros
}

function renderGrade() {
    // CORREÇÃO: Procura por #conteudo (do index.html) em vez de 'main'
    const main = document.getElementById('conteudo');
    if (!main) {
      console.error("Elemento principal '#conteudo' não foi encontrado. A grade não pode ser renderizada.");
      return;
    }
    
    // Lê os valores dos filtros
    const filtroCursoEl = document.getElementById('filtro-curso');
    const filtroPeriodoEl = document.getElementById('filtro-periodo');
    const filtroProfessorEl = document.getElementById('filtro-professor');

    // Garante que os elementos existem antes de ler .value
    const filtroCurso = filtroCursoEl ? filtroCursoEl.value : "";
    const filtroPeriodo = filtroPeriodoEl ? filtroPeriodoEl.value : "";
    const filtroProfessor = filtroProfessorEl ? filtroProfessorEl.value : "";


    let html = '<table class="grade-table"><thead><tr><th>Horário</th>';
    DIAS_SEMANA.forEach(dia => html += `<th>${dia}</th>`);
    html += '</tr></thead><tbody>';

    TIME_SLOTS.forEach(slot => {
        html += `<tr><td class="time-slot">${slot.id}<br>(${slot.start})</td>`;
        DIAS_SEMANA.forEach(dia => {
            // Encontra TODOS os horários para este slot/dia
            const horariosNoSlot = dados.horarios
                .map((h, index) => ({ ...h, originalIndex: index })) // Anexa o índice original
                .filter(h => h.dia === dia && h.slot === slot.id); // <-- CORREÇÃO: slot.id

            // Filtra os horários com base nos filtros selecionados
            const horariosFiltrados = horariosNoSlot.filter(h => {
                // 1. Filtro de Professor (Prioridade)
                if (filtroProfessor) {
                    return h.professor.split(' - ')[1] === filtroProfessor;
                }
                
                // 2. Filtro de Curso/Período (Se Professor não estiver selecionado)
                const disc = dados.disciplinas.find(d => d.codigo === h.disciplina.split(' - ')[0]);
                if (!disc) return false; // Disciplina não encontrada

                if (filtroCurso && disc.curso !== filtroCurso) {
                    return false;
                }
                if (filtroPeriodo && disc.periodo.toString() !== filtroPeriodo) {
                    return false;
                }
                return true;
            });

            // --- Lógica de Destaque de Conflito ---
            let hasConflict = false;
            // Verifica conflitos (professor ou sala) APENAS se mais de 1 horário estiver no slot
            if (horariosNoSlot.length > 1) {
                const professoresNoSlot = horariosNoSlot.map(h => h.professor);
                const salasNoSlot = horariosNoSlot.map(h => h.sala);
                
                // Se houver duplicatas em professores OU salas, marca como conflito
                if (new Set(professoresNoSlot).size !== professoresNoSlot.length ||
                    new Set(salasNoSlot).size !== salasNoSlot.length) {
                    hasConflict = true;
                }
            }
            
            // --- Lógica de Destaque de Grade (Curso/Período) ---
            let hasGradeConflict = false;
            if (horariosNoSlot.length > 1) {
                 // Lógica simplificada:
                 // 1. Pega todos os cursos/períodos no slot
                 const gradesNoSlot = new Map();
                 horariosNoSlot.forEach(h => {
                    const disc = dados.disciplinas.find(d => d.codigo === h.disciplina.split(' - ')[0]);
                    if (disc) {
                        const gradeKey = `${disc.curso}-${disc.periodo}`;
                        if (!gradesNoSlot.has(gradeKey)) {
                            gradesNoSlot.set(gradeKey, new Set());
                        }
                        gradesNoSlot.get(gradeKey).add(disc.codigo);
                    }
                 });

                 // 2. Verifica se alguma grade (curso/periodo) tem mais de uma disciplina
                 for (const disciplinas of gradesNoSlot.values()) {
                    if (disciplinas.size > 1) {
                        hasGradeConflict = true;
                        break;
                    }
                 }
            }

            // Define as classes da célula (TD)
            let tdClasses = 'drop-target';
            if (hasConflict) tdClasses += ' conflict-cell'; // Conflito Prof/Sala
            if (hasGradeConflict) tdClasses += ' grade-conflict-cell'; // Conflito Curso/Periodo

            // Renderiza a célula
            html += `<td class="${tdClasses}" 
                         data-dia="${dia}" 
                         data-slot="${slot.id}"  // <-- CORREÇÃO: slot.id
                         ondrop="drop(event)" 
                         ondragover="allowDrop(event)"
                         ondragleave="dragLeave(event)"
                         onclick="selectCell(event)">`;

            // Renderiza os itens de horário DENTRO da célula
            horariosFiltrados.forEach(h => {
                const discObj = dados.disciplinas.find(d => d.codigo === h.disciplina.split(' - ')[0]);
                const discNome = discObj ? discObj.nome : h.disciplina.split(' - ')[1];
                const profNome = h.professor.split(' - ')[1]; // Pega só o nome
                
                html += `<div class="horario-item" 
                              draggable="true" 
                              ondragstart="dragStart(event, ${h.originalIndex})" 
                              ondragend="dragEnd(event)"
                              onclick="selectHorarioItem(event, ${h.originalIndex})">
                           <span class="disc-code">${h.disciplina.split(' - ')[0]}</span>
                           <span class="disc-nome">${discNome}</span>
                           <span class="prof-nome">${profNome}</span>
                           <span class="sala-nome">Sala: ${h.sala}</span>
                         </div>`;
            });
            html += '</td>';
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    main.innerHTML = html;
}


// --- Funções de Verificação de Conflito (Usadas pelo D&D, C/V e Adicionar) ---

/**
 * Verifica conflito de PROFESSOR em um slot, opcionalmente ignorando um índice.
 * @param {number} [ignoreIndex=-1] - O índice do horário a ser ignorado (para D&D ou C/V).
 */
function findConflitoProfessor(dia, slot, professor, ignoreIndex = -1) {
    return dados.horarios.find((h, i) =>
        i !== ignoreIndex &&
        h.dia === dia &&
        h.slot === slot &&
        h.professor === professor
    );
}

/**
 * Verifica conflito de SALA em um slot, opcionalmente ignorando um índice.
 * @param {number} [ignoreIndex=-1] - O índice do horário a ser ignorado (para D&D ou C/V).
 */
function findConflitoSala(dia, slot, sala, ignoreIndex = -1) {
    return dados.horarios.find((h, i) =>
        i !== ignoreIndex &&
        h.dia === dia &&
        h.slot === slot &&
        h.sala === sala
    );
}

/**
 * *** FUNÇÃO CORRIGIDA (Bug Turma A / Turma B) ***
 * Verifica se já existe uma disciplina DIFERENTE do mesmo curso/período no slot especificado.
 * @param {string} dia - O dia a ser verificado.
 * @param {string} slot - O slot a ser verificado.
 * @param {string} curso - O curso da disciplina (ex: "Engenharia de Software").
 * @param {number|string} periodo - O período da disciplina (ex: 3).
 * @param {string} codigoDisciplinaSendoAdicionada - O código da disciplina que está sendo movida/adicionada.
 * @param {number} [ignoreIndex=-1] - O índice do horário a ser ignorado (para D&D ou C/V).
 * @returns {Object|null} O horário conflitante, se houver, ou null.
 */
function findConflitoCursoPeriodo(dia, slot, curso, periodo, codigoDisciplinaSendoAdicionada, ignoreIndex = -1) {
    
    // 1. Filtra TODOS os horários no slot/dia (exceto o que estamos movendo)
    const horariosNoSlot = dados.horarios.filter((h, i) =>
        i !== ignoreIndex &&
        h.dia === dia &&
        h.slot === slot
    );

    // 2. Desses, filtra os que são do MESMO curso e período
    const horariosMesmaGrade = horariosNoSlot.filter(h => {
        const codigoConflitante = h.disciplina.split(' - ')[0];
        const discObjConflitante = dados.disciplinas.find(d => d.codigo === codigoConflitante);
        
        return (discObjConflitante &&
                discObjConflitante.curso === curso &&
                discObjConflitante.periodo == periodo);
    });

    // 3. Verifica se ALGUM (some) deles é uma DISCIPLINA DIFERENTE
    const conflitoReal = horariosMesmaGrade.some(h => {
        const codigoConflitante = h.disciplina.split(' - ')[0];
        // É um conflito se a disciplina for DIFERENTE da que estamos adicionando
        return codigoConflitante !== codigoDisciplinaSendoAdicionada;
    });

    // 4. Se encontrou um conflito real, retorna o primeiro item conflitante (para a msg de erro)
    if (conflitoReal) {
        // Encontra o primeiro item que causou o conflito real
        return horariosMesmaGrade.find(h => h.disciplina.split(' - ')[0] !== codigoDisciplinaSendoAdicionada);
    }

    // Se 'conflitoReal' for false, significa que todos os itens da mesma grade
    // são da MESMA disciplina (Turma A, B, C...) -> Sem conflito.
    return null;
}


// --- Renderização das Páginas CRUD (Disciplinas, Professores, Salas) ---

function renderDisciplinas(el){
  el.innerHTML = `
    <section>
      <h2>Disciplinas</h2>
      <input id="discCod" placeholder="Código (ex: SI301)">
      <input id="discNome" placeholder="Nome (ex: Algoritmos)">
      <input id="discCurso" placeholder="Curso (ex: Engenharia de Software)">
      <input id="discPeriodo" type="number" placeholder="Período (ex: 3)">
      <button id="addDiscBtn">Adicionar</button>
      <table><tr><th>Código</th><th>Nome</th><th>Curso</th><th>Período</th><th></th></tr>
        ${dados.disciplinas.map((d,i)=>`<tr><td>${d.codigo}</td><td>${d.nome}</td><td>${d.curso}</td><td>${d.periodo}</td><td><button class="del-btn" data-index="${i}">Excluir</button></td></tr>`).join('')}
      </table>
    </section>`;
    
    // Adiciona listeners aos botões
    el.querySelector('#addDiscBtn').onclick = addDisc;
    el.querySelectorAll('.del-btn').forEach(btn => {
        btn.onclick = () => delDisc(btn.dataset.index);
    });
}
function addDisc(){
  const codEl=document.getElementById('discCod'), nomeEl=document.getElementById('discNome'), cursoEl=document.getElementById('discCurso'), periodoEl=document.getElementById('discPeriodo');
  if(!codEl || !nomeEl || !cursoEl || !periodoEl) return; // Proteção
  
  const cod=codEl.value, nome=nomeEl.value, curso=cursoEl.value, periodo=periodoEl.value;
  if(!cod||!nome||!curso||!periodo)return console.warn('Preencha todos!');
  
  dados.disciplinas.push({codigo:cod,nome:nome,curso:curso,periodo:periodo});
  salvar('disciplinas');
  renderMain('disciplinas');
}
function delDisc(i){dados.disciplinas.splice(i,1);salvar('disciplinas');renderMain('disciplinas');}


function renderProfessores(el){
  el.innerHTML = `
    <section>
      <h2>Professores</h2>
      <input id="profDep" placeholder="Departamento (ex: DACOM)">
      <input id="profNome" placeholder="Nome (ex: João Silva)">
      <button id="addProfBtn">Adicionar</button>
      <table><tr><th>Departamento</th><th>Nome</th><th></th></tr>
        ${dados.professores.map((p,i)=>`<tr><td>${p.departamento}</td><td>${p.nome}</td><td><button class="del-btn" data-index="${i}">Excluir</button></td></tr>`).join('')}
      </table>
    </section>`;
    
    // Adiciona listeners
    el.querySelector('#addProfBtn').onclick = addProf;
    el.querySelectorAll('.del-btn').forEach(btn => {
        btn.onclick = () => delProf(btn.dataset.index);
    });
}
function addProf(){
  const depEl=document.getElementById('profDep'), nomeEl=document.getElementById('profNome');
  if(!depEl || !nomeEl) return; // Proteção
  
  const dep=depEl.value, nome=nomeEl.value;
  if(!dep||!nome)return console.warn('Preencha todos!');
  
  dados.professores.push({departamento:dep,nome:nome});
  salvar('professores');
  renderMain('professores');
}
function delProf(i){dados.professores.splice(i,1);salvar('professores');renderMain('professores');}

function renderSalas(el){
  // CORREÇÃO: Removida a 'Descrição'
  el.innerHTML = `
    <section>
      <h2>Salas</h2>
      <input id="salaNome" placeholder="Nome/Número (ex: B01)">
      <button id="addSalaBtn">Adicionar</button>
      <table><tr><th>Nome</th><th></th></tr>
        ${dados.salas.map((s,i)=>`<tr><td>${s.nome}</td><td><button class="del-btn" data-index="${i}">Excluir</button></td></tr>`).join('')}
      </table>
    </section>`;
    
    // Adiciona listeners
    el.querySelector('#addSalaBtn').onclick = addSala;
    el.querySelectorAll('.del-btn').forEach(btn => {
        btn.onclick = () => delSala(btn.dataset.index);
    });
}
function addSala(){
  const nomeEl=document.getElementById('salaNome');
  if(!nomeEl) return; // Proteção
  
  const nome=nomeEl.value;
  if(!nome)return console.warn('Preencha o nome da sala!');
  
  // CORREÇÃO: Removida a 'Descrição'
  dados.salas.push({nome:nome}); 
  salvar('salas');
  renderMain('salas');
}
function delSala(i){dados.salas.splice(i,1);salvar('salas');renderMain('salas');}


// --- Renderização da Página "Montar Horário" (CRUD Horários) ---

// *** FUNÇÃO ATUALIZADA (REFATORADA) ***
// Agora só renderiza a "casca"
function renderHorarios(el){
  // 1. Cria a estrutura principal (a "casca")
  el.innerHTML = `
    <section>
      <h2>Montar Horário</h2>
      <!-- Área para exibir mensagens de sucesso ou erro -->
      <div id="horario-message" style="margin-bottom: 10px; padding: 10px; border-radius: 5px; display: none;"></div>
      
      <!-- Contêiner para o formulário (só será renderizado 1 vez) -->
      <div id="horario-form-container"></div>
      
      <!-- Contêiner para a tabela (será atualizado) -->
      <div id="horario-table-container"></div>
    </section>
  `;

  // 2. Chama as novas funções para preencher a casca
  // (Note que usamos .querySelector(el) para garantir que estamos no elemento certo)
  renderHorariosForm(el.querySelector('#horario-form-container'));
  renderHorariosTable(el.querySelector('#horario-table-container'));
}

// *** NOVA FUNÇÃO ***
/**
 * Renderiza APENAS o formulário de adição de horário.
 * Não será chamada em atualizações.
 */
function renderHorariosForm(containerEl) {
    if (!containerEl) return;
    
    // CORREÇÃO: Removida a 'Descrição' do dropdown de salas
    containerEl.innerHTML = `
      <select id="horDisc">${dados.disciplinas.map(d=>`<option>${d.codigo} - ${d.nome}</option>`).join('')}</select>
      <select id="horProf">${dados.professores.map(p=>`<option>${p.departamento} - ${p.nome}</option>`).join('')}</select>
      <select id="horDia">${DIAS_SEMANA.map(d=>`<option>${d}</option>`).join('')}</select>
      <select id="horSlot">${TIME_SLOTS.map(t=>`<option>${t.id}</option>`).join('')}</select>
      <select id="horSala">${dados.salas.map(s=>`<option value="${s.nome}">${s.nome}</option>`).join('')}</select>
      <button id="addHorarioBtn">Adicionar</button>
    `;
    
    // Adiciona listener
    containerEl.querySelector('#addHorarioBtn').onclick = addHorario;
}

// *** NOVA FUNÇÃO ***
/**
 * Renderiza APENAS a tabela de horários.
 * Esta função será chamada para atualizar a lista.
 */
function renderHorariosTable(containerEl) {
    // Se o containerEl não for passado, ele tenta encontrar o padrão
    const container = containerEl || document.getElementById('horario-table-container');
    
    if (container) {
        // CORREÇÃO: Removida a 'Descrição' da tabela
        container.innerHTML = `
          <table><tr><th>Disciplina</th><th>Professor</th><th>Dia</th><th>Slot</th><th>Sala</th><th></th></tr>
            ${dados.horarios.map((h,i)=>`<tr><td>${h.disciplina}</td><td>${h.professor}</td><td>${h.dia}</td><td>${h.slot}</td><td>${h.sala}</td><td><button class="del-hor-btn" data-index="${i}">Excluir</button></td></tr>`).join('')}
          </table>
        `;
        
        // Adiciona listeners
        container.querySelectorAll('.del-hor-btn').forEach(btn => {
            btn.onclick = () => delHorario(btn.dataset.index);
        });
    }
}

// Função de ajuda para exibir mensagens na tela de Horários
function showMessage(message, type) {
    const msgDiv = document.getElementById('horario-message');
    if (msgDiv) {
        msgDiv.textContent = message;
        msgDiv.style.display = 'block';
        msgDiv.style.backgroundColor = type === 'error' ? '#f8d7da' : '#d4edda';
        msgDiv.style.color = type === 'error' ? '#721c24' : '#155724';
    } else {
        // Fallback se o elemento não for encontrado
        showToast(message, type);
    }
}

// *** FUNÇÃO ATUALIZADA (REFATORADA) ***
function addHorario(){
  // 1. Obter valores (agora busca os IDs no escopo global)
  const discEl=document.getElementById('horDisc'), profEl=document.getElementById('horProf'), diaEl=document.getElementById('horDia'), slotEl=document.getElementById('horSlot'), salaEl=document.getElementById('horSala');
  if (!discEl || !profEl || !diaEl || !slotEl || !salaEl) return; // Proteção
  
  const disc=discEl.value, prof=profEl.value, dia=diaEl.value, slot=slotEl.value, sala=salaEl.value;
  if(!disc||!prof||!dia||!slot||!sala) {
      showMessage('Erro: Preencha todos os campos!', 'error');
      return;
  }

  // Limpa mensagens de erro anteriores
  const msgDiv = document.getElementById('horario-message');
  if (msgDiv) {
      showMessage('', 'success');
      msgDiv.style.display = 'none';
  }

  // --- Validação da Disciplina (Necessário para a nova verificação) ---
  const codigoDisciplina = disc.split(' - ')[0];
  const discObj = dados.disciplinas.find(d => d.codigo === codigoDisciplina);

  if (!discObj) {
      showMessage('Erro: Dados da disciplina não encontrados.', 'error');
      return;
  }
  const cursoDaDisciplina = discObj.curso;
  const periodoDaDisciplina = discObj.periodo;
  // --- Fim da validação ---

  // 2. VERIFICAÇÃO DE CONFLITO DE PROFESSOR:
  const conflitoProfessor = findConflitoProfessor(dia, slot, prof, -1); // -1 = não ignorar nada
  if (conflitoProfessor) {
      const message = `Conflito de Horário! O professor ${prof} já está alocado para o slot ${slot} na ${dia}.`;
      showMessage(message, 'error');
      return; // Impede a adição
  }

    // 3. VERIFICAÇÃO DE CONFLITO DE SALA:
  const conflitoSala = findConflitoSala(dia, slot, sala, -1); // -1 = não ignorar nada
  if (conflitoSala) {
      const message = `Conflito de Ensalamento! A sala ${sala} já está ocupada pela disciplina ${conflitoSala.disciplina.split(' - ')[0]} no slot ${slot} na ${dia}.`;
      showMessage(message, 'error');
      return; // Impede a adição
  }

    // 4. VERIFICAÇÃO DE CONFLITO DE CURSO/PERÍODO (CHAMADA ATUALIZADA)
    // *** ALTERAÇÃO AQUI: Passa 'codigoDisciplina' ***
    const conflitoCursoPeriodo = findConflitoCursoPeriodo(dia, slot, cursoDaDisciplina, periodoDaDisciplina, codigoDisciplina, -1); 

    if (conflitoCursoPeriodo) {
        const discConflitante = conflitoCursoPeriodo.disciplina.split(' - ')[0];
        const message = `Conflito de Grade! O ${periodoDaDisciplina}º período de ${cursoDaDisciplina} já possui a disciplina ${discConflitante} neste mesmo horário (${dia} - ${slot}).`;
        showMessage(message, 'error');
        return; // Impede a adição
    }
    
  // 5. Se não houver conflito, adiciona, salva e re-renderiza
  dados.horarios.push({disciplina:disc,professor:prof,dia:dia,slot:slot,sala:sala});
  salvar('horarios'); // Persiste Horários
  
  // *** AQUI ESTÁ A MUDANÇA (Não reseta o formulário): ***
  renderHorariosTable(); // ATUALIZA SÓ A TABELA
  
  // Exibe mensagem de sucesso na própria página de horários
  showMessage('Horário adicionado com sucesso!', 'success');
}

// *** FUNÇÃO ATUALIZADA (REFATORADA) ***
function delHorario(i){
    dados.horarios.splice(i,1);
    salvar('horarios');
    
    // *** AQUI ESTÁ A MUDANÇA: ***
    renderHorariosTable(); // ATUALIZA SÓ A TABELA
    
    // Mostra a mensagem de sucesso
    showMessage('Horário excluído com sucesso.', 'success');
}


// --- INICIALIZAÇÃO E EVENT LISTENERS GLOBAIS ---

// Listener global para atalhos (Copiar, Colar, Deletar)
document.addEventListener('keydown', (event) => {
    // Ignora atalhos se estivermos digitando em inputs (como nos CRUDS)
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT')) {
        return;
    }

    // Verificar Ctrl+C (ou Cmd+C no Mac)
    if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) {
        if (selectionMode === 'item' && clipboardHorarioIndex !== null) {
            event.preventDefault();
            copyHorario(); // Chama a lógica principal de cópia
        }
    }

    // Verificar Ctrl+V (ou Cmd+V no Mac)
    if ((event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')) {
        // Cola APENAS se o modo for 'cell' (clicamos numa célula vazia)
        if (selectionMode === 'cell' && clipboardHorarioIndex !== null && clipboardTarget.dia !== null) {
            event.preventDefault();
            pasteHorario(); // Chama a lógica principal de colagem
        }
    }

    // Verificar Delete (ou Backspace)
    if (event.key === 'Delete' || event.key === 'Backspace') {
        // Deleta APENAS se o modo for 'item'
        if (selectionMode === 'item' && clipboardHorarioIndex !== null) {
            event.preventDefault();
            deleteSelectedHorario();
        }
    }
});

// *** CÓDIGO DE INICIALIZAÇÃO MOVIDO PARA 'DOMContentLoaded' ***
document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Anexa listeners aos botões de navegação
    document.querySelectorAll('nav button').forEach(b=> {
      b.onclick=()=>renderMain(b.dataset.section);
    });

    // 2. Anexa listeners aos filtros (com verificação)
    const filtroCursoEl = document.getElementById('filtro-curso');
    const filtroPeriodoEl = document.getElementById('filtro-periodo');
    const filtroProfessorEl = document.getElementById('filtro-professor');
    const gerarGradeBtn = document.getElementById('gerar-grade-btn');

    if (filtroCursoEl) {
        filtroCursoEl.addEventListener('change', () => {
            // Limpa o professor se o curso/periodo for selecionado
            if (filtroProfessorEl) filtroProfessorEl.value = "";
        });
    } else {
        console.warn('#filtro-curso não encontrado ao anexar listener.');
    }

    if (filtroPeriodoEl) {
        filtroPeriodoEl.addEventListener('change', () => {
            // Limpa o professor se o curso/periodo for selecionado
            if (filtroProfessorEl) filtroProfessorEl.value = "";
        });
    } else {
        console.warn('#filtro-periodo não encontrado ao anexar listener.');
    }

    if (filtroProfessorEl) {
        filtroProfessorEl.addEventListener('change', () => {
            // Limpa o curso/periodo se o professor for selecionado
            if (filtroProfessorEl.value) { // Se um professor foi selecionado
                if (filtroCursoEl) filtroCursoEl.value = "";
                if (filtroPeriodoEl) filtroPeriodoEl.value = "";
            }
        });
    } else {
        console.warn('#filtro-professor não encontrado ao anexar listener.');
    }

    if (gerarGradeBtn) {
        gerarGradeBtn.onclick = aplicarFiltrosEConflictos;
    } else {
         console.warn('#gerar-grade-btn não encontrado ao anexar listener.');
    }


    // 3. Carrega todos os dados iniciais
    carregarTudo();
});


// --- EXPOSIÇÃO DE FUNÇÕES GLOBAIS (necessário para 'onclick') ---
// (Estas são as funções chamadas diretamente pelo HTML gerado)
window.dragStart = dragStart;
window.dragEnd = dragEnd;
window.allowDrop = allowDrop;
window.dragLeave = dragLeave;
window.drop = drop;
window.selectHorarioItem = selectHorarioItem;
window.selectCell = selectCell;
window.aplicarFiltrosEConflictos = aplicarFiltrosEConflictos;

// Funções dos CRUDS (são anexadas dinamicamente, mas expor não faz mal)
window.addDisc = addDisc;
window.delDisc = delDisc;
window.addProf = addProf;
window.delProf = delProf;
window.addSala = addSala;
window.delSala = delSala;
window.addHorario = addHorario;
window.delHorario = delHorario;

