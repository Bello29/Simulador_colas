import {
  ANALISIS_COMPARATIVO,
  ESCENARIOS,
  aplicarEscenario,
  crearConfiguracionInicial,
} from "./config.js";

/*
 * Conversión de horas a minutos para presentar métricas de forma más natural.
 */
const MINUTOS_POR_HORA = 60;
const SEGUNDOS_POR_HORA = 3600;

/*
 * Funciones auxiliares de teoría de colas.
 * Se incluyen para dejar explícita la base cuantitativa del análisis mostrado
 * en la interfaz, tanto para M/M/1 como para M/M/c.
 */
function factorial(numero) {
  if (numero <= 1) {
    return 1;
  }

  let resultado = 1;

  for (let indice = 2; indice <= numero; indice += 1) {
    resultado *= indice;
  }

  return resultado;
}

function calcularMM1(lambda, mu) {
  const rho = lambda / mu;

  if (rho >= 1) {
    return {
      estable: false,
      rho,
      Lq: Infinity,
      L: Infinity,
      WqHoras: Infinity,
      WHoras: Infinity,
    };
  }

  const Lq = (rho ** 2) / (1 - rho);
  const L = rho / (1 - rho);
  const WqHoras = Lq / lambda;
  const WHoras = L / lambda;

  return { estable: true, rho, Lq, L, WqHoras, WHoras };
}

function calcularMMC(lambda, mu, servidores) {
  const a = lambda / mu;
  const rho = lambda / (servidores * mu);

  if (rho >= 1) {
    return {
      estable: false,
      rho,
      Lq: Infinity,
      L: Infinity,
      WqHoras: Infinity,
      WHoras: Infinity,
    };
  }

  let suma = 0;

  for (let n = 0; n < servidores; n += 1) {
    suma += (a ** n) / factorial(n);
  }

  const terminoFinal =
    (a ** servidores) / (factorial(servidores) * (1 - rho));
  const p0 = 1 / (suma + terminoFinal);
  const Lq =
    (p0 * (a ** servidores) * rho) /
    (factorial(servidores) * (1 - rho) ** 2);
  const L = Lq + a;
  const WqHoras = Lq / lambda;
  const WHoras = L / lambda;

  return { estable: true, rho, Lq, L, WqHoras, WHoras };
}

/*
 * Crea un sprite reutilizable con soporte de imagen real y fallback visual.
 * Si el archivo PNG no existe, la simulación sigue siendo funcional.
 */
function crearSpriteImagen(src, fallbackClass) {
  const image = document.createElement("img");
  const fallback = document.createElement("div");

  image.src = src;
  image.alt = "";

  fallback.className = fallbackClass;
  fallback.hidden = true;

  image.addEventListener("error", () => {
    image.style.display = "none";
    fallback.hidden = false;
  });

  return { image, fallback };
}

/*
 * Clase Cliente.
 * Modela a cada entidad de la cola con datos de tiempo, estado operativo,
 * coordenadas actuales y un objetivo hacia el que se desplaza suavemente.
 */
class Cliente {
  constructor(id, simulacion) {
    this.id = id;
    this.simulacion = simulacion;

    this.estado = "entrando";

    this.x = 0;
    this.y = 0;
    this.objetivoX = 0;
    this.objetivoY = 0;

    this.instanteLlegada = simulacion.tiempoSimuladoHoras;
    this.instanteInicioServicio = null;
    this.instanteFinServicio = null;
    this.instanteSalida = null;
    this.duracionServicio = 0;

    this.asesoraAsignada = null;
    this.posicionCola = -1;

    this.elemento = document.createElement("div");
    this.elemento.className = "sprite cliente-sprite";

    this.label = document.createElement("span");
    this.label.className = "client-label";
    this.label.textContent = `C${id}`;

    const sprite = crearSpriteImagen(
      simulacion.obtenerSpriteCliente(),
      "fallback-avatar client"
    );

    this.elemento.append(sprite.image, sprite.fallback, this.label);
    this.simulacion.dom.clientsLayer.appendChild(this.elemento);
  }

  /*
   * Posiciona al cliente instantáneamente.
   * Solo se utiliza en la creación inicial para evitar arrastres desde 0,0.
   */
  establecerPosicion(x, y) {
    this.x = x;
    this.y = y;
    this.objetivoX = x;
    this.objetivoY = y;
    this.renderizar();
  }

  /*
   * Define el próximo destino del cliente.
   * El desplazamiento posterior ocurre gradualmente en cada frame.
   */
  moverHacia(x, y) {
    this.objetivoX = x;
    this.objetivoY = y;
  }

  /*
   * Determina si el cliente ya está suficientemente cerca de su destino.
   */
  haLlegadoAlObjetivo() {
    const dx = this.objetivoX - this.x;
    const dy = this.objetivoY - this.y;
    return Math.hypot(dx, dy) < 2;
  }

  /*
   * Actualiza el movimiento visual usando velocidad configurable en píxeles
   * por segundo real. Así el usuario percibe claramente el recorrido.
   */
  actualizar(dtRealSegundos) {
    const dx = this.objetivoX - this.x;
    const dy = this.objetivoY - this.y;
    const distancia = Math.hypot(dx, dy);

    if (distancia < 0.001) {
      this.x = this.objetivoX;
      this.y = this.objetivoY;
      this.renderizar();
      return;
    }

    const paso =
      this.simulacion.configuracion.visual.velocidadMovimiento * dtRealSegundos;

    if (paso >= distancia) {
      this.x = this.objetivoX;
      this.y = this.objetivoY;
    } else {
      this.x += (dx / distancia) * paso;
      this.y += (dy / distancia) * paso;
    }

    this.renderizar();
  }

  /*
   * Sincroniza la representación DOM con el estado actual del cliente.
   */
  renderizar() {
    const tamaño = this.simulacion.configuracion.visual.tamañoCliente;
    this.elemento.style.width = `${tamaño}px`;
    this.elemento.style.height = `${tamaño}px`;
    this.elemento.style.left = `${this.x}px`;
    this.elemento.style.top = `${this.y}px`;
    this.elemento.classList.toggle("is-in-service", this.estado === "enServicio");
  }

  destruir() {
    this.elemento.remove();
  }
}

/*
 * Clase Cola.
 * Garantiza la disciplina FIFO y se ocupa de recalcular los objetivos visuales
 * para que no aparezcan huecos cuando avanza el frente de la fila.
 */
class Cola {
  constructor(simulacion) {
    this.simulacion = simulacion;
    this.clientes = [];
  }

  puedeIngresar() {
    return this.clientes.length < this.simulacion.configuracion.operacion.capacidadCola;
  }

  encolar(cliente) {
    if (!this.puedeIngresar()) {
      return false;
    }

    this.clientes.push(cliente);
    cliente.estado = "yendoACola";
    this.recalcularPosiciones();
    return true;
  }

  desencolar() {
    const cliente = this.clientes.shift() || null;
    this.recalcularPosiciones();
    return cliente;
  }

  primero() {
    return this.clientes[0] || null;
  }

  longitud() {
    return this.clientes.length;
  }

  recalcularPosiciones() {
    this.clientes.forEach((cliente, indice) => {
      const slot = this.simulacion.layout.queueSlots[indice];

      cliente.posicionCola = indice;
      cliente.estado = indice === 0 ? "frenteCola" : "enCola";

      if (slot) {
        cliente.moverHacia(slot.x, slot.y);
      }
    });
  }
}

/*
 * Clase Asesora.
 * Representa cada servidor del sistema. Puede reservar a un cliente, iniciar
 * el servicio cuando este llega al escritorio y liberar el puesto al finalizar.
 */
class Asesora {
  constructor(id, simulacion, posicion) {
    this.id = id;
    this.simulacion = simulacion;
    this.posicion = posicion;

    this.clienteActual = null;
    this.ocupada = false;
    this.servicioIniciado = false;
    this.tiempoRestanteHoras = 0;
    this.tiempoOcupadoAcumulado = 0;

    this.elementoDesk = document.createElement("div");
    this.elementoDesk.className = "desk";

    const surface = document.createElement("div");
    surface.className = "desk-surface";

    const accent = document.createElement("div");
    accent.className = "desk-accent";

    this.elementoDesk.append(surface, accent);
    this.simulacion.dom.advisorsLayer.appendChild(this.elementoDesk);

    this.elementoSprite = document.createElement("div");
    this.elementoSprite.className = "sprite asesora-sprite";

    const sprite = crearSpriteImagen(
      simulacion.obtenerSpriteAsesora(id - 1),
      "fallback-avatar"
    );

    this.elementoSprite.append(sprite.image, sprite.fallback);
    this.simulacion.dom.advisorsLayer.appendChild(this.elementoSprite);

    this.elementoEtiqueta = document.createElement("div");
    this.elementoEtiqueta.className = "advisor-station-label";
    this.elementoEtiqueta.textContent = `Puesto ${id}`;
    this.simulacion.dom.advisorsLayer.appendChild(this.elementoEtiqueta);

    this.renderizar();
  }

  get libre() {
    return !this.ocupada;
  }

  /*
   * Reserva a un cliente para esta asesora.
   * El servicio no arranca hasta que el cliente llega físicamente al escritorio.
   */
  asignarCliente(cliente, duracionHoras) {
    this.clienteActual = cliente;
    this.ocupada = true;
    this.servicioIniciado = false;
    this.tiempoRestanteHoras = duracionHoras;

    cliente.asesoraAsignada = this;
    cliente.duracionServicio = duracionHoras;
    cliente.estado = "yendoAServicio";
    cliente.moverHacia(this.posicion.clienteX, this.posicion.clienteY);
  }

  /*
   * Avanza el estado de servicio.
   * Devuelve un cliente cuando el servicio termina y debe pasar a salida.
   */
  actualizar(dtHoras) {
    if (!this.clienteActual) {
      return null;
    }

    if (!this.servicioIniciado) {
      if (this.clienteActual.haLlegadoAlObjetivo()) {
        this.servicioIniciado = true;
        this.clienteActual.estado = "enServicio";
        this.clienteActual.instanteInicioServicio =
          this.simulacion.tiempoSimuladoHoras;
      }

      return null;
    }

    this.tiempoRestanteHoras -= dtHoras;
    this.tiempoOcupadoAcumulado += dtHoras;

    if (this.tiempoRestanteHoras > 0) {
      return null;
    }

    const cliente = this.clienteActual;
    cliente.instanteFinServicio = this.simulacion.tiempoSimuladoHoras;

    this.clienteActual = null;
    this.ocupada = false;
    this.servicioIniciado = false;
    this.tiempoRestanteHoras = 0;

    return cliente;
  }

  actualizarPosicion(posicion) {
    this.posicion = posicion;
    this.renderizar();

    if (this.clienteActual) {
      this.clienteActual.moverHacia(posicion.clienteX, posicion.clienteY);
    }
  }

  renderizar() {
    const tamaño = this.simulacion.configuracion.visual.tamañoAsesora;

    this.elementoDesk.style.left = `${this.posicion.deskX}px`;
    this.elementoDesk.style.top = `${this.posicion.deskY}px`;

    this.elementoSprite.style.left = `${this.posicion.spriteX}px`;
    this.elementoSprite.style.top = `${this.posicion.spriteY}px`;
    this.elementoSprite.style.width = `${tamaño}px`;
    this.elementoSprite.style.height = `${tamaño}px`;

    this.elementoEtiqueta.style.left = `${this.posicion.spriteX}px`;
    this.elementoEtiqueta.style.top = `${this.posicion.spriteY - tamaño / 2 - 28}px`;
  }

  destruir() {
    this.elementoDesk.remove();
    this.elementoSprite.remove();
    this.elementoEtiqueta.remove();
  }
}

/*
 * Clase Simulacion.
 * Orquesta el motor de eventos, la cola, las asesoras, el renderizado y las
 * métricas globales de la demostración.
 */
class Simulacion {
  constructor() {
    this.configuracion = crearConfiguracionInicial();
    this.escenarioActual = "temporadaBaja";
    this.factorVelocidad = 1;

    this.dom = {
      scene: document.getElementById("scene"),
      queueTrack: document.getElementById("queueTrack"),
      advisorsLayer: document.getElementById("advisorsLayer"),
      clientsLayer: document.getElementById("clientsLayer"),
      eventLog: document.getElementById("eventLog"),
      simulationClock: document.getElementById("simulationClock"),
      scenarioBadge: document.getElementById("scenarioBadge"),
      statusLabel: document.getElementById("statusLabel"),
      startButton: document.getElementById("startButton"),
      pauseButton: document.getElementById("pauseButton"),
      resetButton: document.getElementById("resetButton"),
      scenarioButtons: Array.from(document.querySelectorAll("[data-scenario]")),
      speedFactor: document.getElementById("speedFactor"),
      speedFactorLabel: document.getElementById("speedFactorLabel"),
      metricGenerated: document.getElementById("metricGenerated"),
      metricServed: document.getElementById("metricServed"),
      metricWaiting: document.getElementById("metricWaiting"),
      metricAvgWait: document.getElementById("metricAvgWait"),
      metricAvgSystem: document.getElementById("metricAvgSystem"),
      metricUtilization: document.getElementById("metricUtilization"),
      metricAvgQueue: document.getElementById("metricAvgQueue"),
      theoryModelBadge: document.getElementById("theoryModelBadge"),
      theoryScenarioTitle: document.getElementById("theoryScenarioTitle"),
      theoryScenarioSummary: document.getElementById("theoryScenarioSummary"),
      criticalCaseCard: document.getElementById("criticalCaseCard"),
      criticalCaseTitle: document.getElementById("criticalCaseTitle"),
      criticalCaseDetail: document.getElementById("criticalCaseDetail"),
      theoryStability: document.getElementById("theoryStability"),
      theoryReading: document.getElementById("theoryReading"),
      theoryIndicators: document.getElementById("theoryIndicators"),
      comparativeSummary: document.getElementById("comparativeSummary"),
      comparativeList: document.getElementById("comparativeList"),
      proposalList: document.getElementById("proposalList"),
      summaryModal: document.getElementById("summaryModal"),
      closeSummaryModal: document.getElementById("closeSummaryModal"),
      summaryModalNote: document.getElementById("summaryModalNote"),
      summaryScenario: document.getElementById("summaryScenario"),
      summaryModel: document.getElementById("summaryModel"),
      summaryTotalTime: document.getElementById("summaryTotalTime"),
      summaryCleanupTime: document.getElementById("summaryCleanupTime"),
      summaryGenerated: document.getElementById("summaryGenerated"),
      summaryServed: document.getElementById("summaryServed"),
      summaryRejected: document.getElementById("summaryRejected"),
      summaryUtilization: document.getElementById("summaryUtilization"),
      summaryAvgWait: document.getElementById("summaryAvgWait"),
      summaryAvgSystem: document.getElementById("summaryAvgSystem"),
      summaryAvgQueue: document.getElementById("summaryAvgQueue"),
      summaryIdleTime: document.getElementById("summaryIdleTime"),
      summaryRunInterpretation: document.getElementById("summaryRunInterpretation"),
      summaryStaffingList: document.getElementById("summaryStaffingList"),
    };

    this.animacionId = null;
    this.ultimoFrame = null;
    this.enEjecucion = false;
    this.layout = {
      entry: { x: 0, y: 0 },
      exit: { x: 0, y: 0 },
      queueSlots: [],
      advisors: [],
    };

    this.aplicarEscenario(this.escenarioActual, false);
    this.reiniciarEstado();
    this.vincularEventos();
    this.actualizarFondoEscena();
    this.calcularLayout();
    this.construirPuestosCola();
    this.construirAsesoras();
    this.renderizarMetricas();
    this.renderizarRegistro();
    this.renderizarAnalisisAcademico();
    this.sincronizarVelocidad();
  }

  reiniciarEstado() {
    if (this.animacionId) {
      cancelAnimationFrame(this.animacionId);
      this.animacionId = null;
    }

    this.enEjecucion = false;
    this.ultimoFrame = null;
    this.tiempoSimuladoHoras = 0;
    this.siguienteIdCliente = 1;
    this.clientesActivos = [];
    this.clientesGenerados = 0;
    this.clientesAtendidos = 0;
    this.acumuladoEsperaHoras = 0;
    this.acumuladoSistemaHoras = 0;
    this.areaLongitudCola = 0;
    this.eventos = [];
    this.jornadaFinalizada = false;
    this.jornadaLlegadasCerradas = false;
    this.clientesRechazados = 0;
    this.clientesPendientesAlCierre = 0;
    this.prepararSecuenciaSpritesClientes();

    this.cola = new Cola(this);
    this.ocultarModalResumen();

    if (this.dom.clientsLayer) {
      this.dom.clientsLayer.innerHTML = "";
    }

    if (this.asesoras) {
      this.asesoras.forEach((asesora) => asesora.destruir());
    }

    this.asesoras = [];
    this.programarSiguienteLlegada();
    this.actualizarEtiquetaEstado();
  }

  obtenerListaSpritesClientes() {
    const { sprites } = this.configuracion;

    if (Array.isArray(sprites?.clientes) && sprites.clientes.length > 0) {
      return sprites.clientes;
    }

    return sprites?.cliente ? [sprites.cliente] : [];
  }

  obtenerListaSpritesAsesoras() {
    const { sprites } = this.configuracion;

    if (Array.isArray(sprites?.asesoras) && sprites.asesoras.length > 0) {
      return sprites.asesoras;
    }

    return sprites?.asesora ? [sprites.asesora] : [];
  }

  mezclarArreglo(items) {
    const copia = [...items];

    for (let indice = copia.length - 1; indice > 0; indice -= 1) {
      const aleatorio = Math.floor(Math.random() * (indice + 1));
      [copia[indice], copia[aleatorio]] = [copia[aleatorio], copia[indice]];
    }

    return copia;
  }

  prepararSecuenciaSpritesClientes() {
    this.secuenciaSpritesClientes = this.mezclarArreglo(
      this.obtenerListaSpritesClientes()
    );
    this.indiceSpriteCliente = 0;
  }

  obtenerSpriteCliente() {
    const sprites = this.obtenerListaSpritesClientes();

    if (sprites.length === 0) {
      return "";
    }

    if (
      !Array.isArray(this.secuenciaSpritesClientes) ||
      this.secuenciaSpritesClientes.length === 0
    ) {
      this.prepararSecuenciaSpritesClientes();
    }

    if (this.indiceSpriteCliente >= this.secuenciaSpritesClientes.length) {
      this.secuenciaSpritesClientes = this.mezclarArreglo(sprites);
      this.indiceSpriteCliente = 0;
    }

    const sprite = this.secuenciaSpritesClientes[this.indiceSpriteCliente];
    this.indiceSpriteCliente += 1;
    return sprite;
  }

  obtenerSpriteAsesora(indice) {
    const sprites = this.obtenerListaSpritesAsesoras();

    if (sprites.length === 0) {
      return "";
    }

    return sprites[indice % sprites.length];
  }

  vincularEventos() {
    this.dom.startButton.addEventListener("click", () => this.iniciar());
    this.dom.pauseButton.addEventListener("click", () => this.pausar());
    this.dom.resetButton.addEventListener("click", () => this.reiniciar());

    this.dom.scenarioButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const clave = button.dataset.scenario;
        this.aplicarEscenario(clave, true);
      });
    });

    window.addEventListener("resize", () => {
      this.calcularLayout();
      this.construirPuestosCola();
      this.actualizarPosicionesTrasResize();
    });

    this.dom.speedFactor.addEventListener("input", () => {
      const valor = Number(this.dom.speedFactor.value);
      this.factorVelocidad = Number.isFinite(valor) ? valor : 1;
      this.sincronizarVelocidad();
    });

    this.dom.closeSummaryModal?.addEventListener("click", () =>
      this.ocultarModalResumen()
    );
    this.dom.summaryModal?.addEventListener("click", (evento) => {
      if (evento.target === this.dom.summaryModal) {
        this.ocultarModalResumen();
      }
    });
  }

  /*
   * Activa la corrida utilizando requestAnimationFrame para lograr una
   * experiencia suave y continua.
   */
  iniciar() {
    if (this.enEjecucion) {
      return;
    }

    this.enEjecucion = true;
    this.ultimoFrame = null;
    this.actualizarEtiquetaEstado();
    this.animacionId = requestAnimationFrame((timestamp) => this.bucle(timestamp));
  }

  pausar() {
    this.enEjecucion = false;
    this.actualizarEtiquetaEstado();

    if (this.animacionId) {
      cancelAnimationFrame(this.animacionId);
      this.animacionId = null;
    }
  }

  reiniciar() {
    this.factorVelocidad = 1;
    this.reiniciarEstado();
    this.construirAsesoras();
    this.cola.recalcularPosiciones();
    this.renderizarMetricas();
    this.renderizarRegistro();
    this.sincronizarVelocidad();
  }

  bucle(timestamp) {
    if (!this.enEjecucion) {
      return;
    }

    if (!this.ultimoFrame) {
      this.ultimoFrame = timestamp;
    }

    const dtRealSegundos = Math.min((timestamp - this.ultimoFrame) / 1000, 0.05);
    this.ultimoFrame = timestamp;

    const dtHoras =
      (dtRealSegundos *
        this.configuracion.visual.escalaTiempoVisual *
        this.factorVelocidad) /
      SEGUNDOS_POR_HORA;

    this.actualizar(dtRealSegundos, dtHoras);
    this.animacionId = requestAnimationFrame((nuevoTimestamp) =>
      this.bucle(nuevoTimestamp)
    );
  }

  actualizar(dtRealSegundos, dtHoras) {
    const duracionJornadaHoras =
      this.configuracion.operacion.jornadaLaboralHoras || 8;
    const tiempoAntesFrame = this.tiempoSimuladoHoras;
    const tiempoDespuesFrame = tiempoAntesFrame + dtHoras;
    const ventanaConLlegadas = this.jornadaLlegadasCerradas
      ? 0
      : Math.max(
          Math.min(duracionJornadaHoras, tiempoDespuesFrame) - tiempoAntesFrame,
          0
        );

    this.tiempoSimuladoHoras = tiempoDespuesFrame;
    this.areaLongitudCola += this.cola.longitud() * dtHoras;

    let tiempoDisponibleParaLlegadas = ventanaConLlegadas;
    while (tiempoDisponibleParaLlegadas > 0) {
      if (this.siguienteLlegadaEnHoras > tiempoDisponibleParaLlegadas) {
        this.siguienteLlegadaEnHoras -= tiempoDisponibleParaLlegadas;
        tiempoDisponibleParaLlegadas = 0;
        break;
      }

      tiempoDisponibleParaLlegadas -= this.siguienteLlegadaEnHoras;
      this.generarCliente();
      this.siguienteLlegadaEnHoras = this.muestrearTiempoEntreLlegadas();
    }

    this.clientesActivos.forEach((cliente) => cliente.actualizar(dtRealSegundos));

    this.intentarAsignarClientes();
    this.actualizarAsesoras(dtHoras);
    this.procesarSalidas();

    if (!this.jornadaLlegadasCerradas && tiempoDespuesFrame >= duracionJornadaHoras) {
      this.cerrarLlegadas();
    }

    if (this.jornadaLlegadasCerradas && this.estaSistemaVacio()) {
      this.finalizarCorrida();
      return;
    }

    this.renderizarMetricas();
    this.renderizarRegistro();
  }

  /*
   * Distribución exponencial manual para cumplir con el requisito de no usar
   * librerías externas de simulación.
   */
  muestrearExponencial(tasaPorHora) {
    const u = Math.max(Math.random(), 1e-7);
    return -Math.log(1 - u) / tasaPorHora;
  }

  muestrearTiempoEntreLlegadas() {
    return this.muestrearExponencial(this.configuracion.operacion.tasaLlegada);
  }

  muestrearTiempoServicio() {
    const mediaHoras = this.configuracion.operacion.tiempoServicio;
    const tasaServicio = 1 / mediaHoras;
    return this.muestrearExponencial(tasaServicio);
  }

  programarSiguienteLlegada() {
    this.siguienteLlegadaEnHoras = this.muestrearTiempoEntreLlegadas();
  }

  generarCliente() {
    const cliente = new Cliente(this.siguienteIdCliente++, this);

    cliente.establecerPosicion(this.layout.entry.x, this.layout.entry.y);

    this.clientesActivos.push(cliente);
    this.clientesGenerados += 1;

    if (this.cola.encolar(cliente)) {
      this.registrarEvento(
        `Cliente C${cliente.id} entra al sistema y toma lugar en la sala de espera.`
      );
      return;
    }

    /*
     * Cuando la cola alcanza su capacidad, el cliente no se integra a la
     * operación interna. Se visualiza el rechazo y abandona la escena.
     */
    cliente.estado = "rechazado";
    this.clientesRechazados += 1;
    cliente.moverHacia(this.layout.exit.x, this.layout.exit.y + 78);
    this.registrarEvento(
      `Cliente C${cliente.id} no pudo ingresar a la cola por capacidad máxima.`
    );
  }

  intentarAsignarClientes() {
    this.asesoras.forEach((asesora) => {
      if (!asesora.libre) {
        return;
      }

      const primero = this.cola.primero();

      if (!primero || !primero.haLlegadoAlObjetivo()) {
        return;
      }

      const cliente = this.cola.desencolar();
      const duracionServicio = this.muestrearTiempoServicio();

      asesora.asignarCliente(cliente, duracionServicio);

      this.registrarEvento(
        `Cliente C${cliente.id} avanza al puesto ${asesora.id} para iniciar atención.`
      );
    });
  }

  actualizarAsesoras(dtHoras) {
    this.asesoras.forEach((asesora) => {
      const clienteFinalizado = asesora.actualizar(dtHoras);

      if (!clienteFinalizado) {
        return;
      }

      clienteFinalizado.estado = "saliendo";
      clienteFinalizado.moverHacia(this.layout.exit.x, this.layout.exit.y);

      this.registrarEvento(
        `Cliente C${clienteFinalizado.id} finaliza su atención y se dirige a la salida.`
      );

      if (clienteFinalizado.instanteInicioServicio !== null) {
        this.acumuladoEsperaHoras +=
          clienteFinalizado.instanteInicioServicio -
          clienteFinalizado.instanteLlegada;
      }
    });
  }

  procesarSalidas() {
    const restantes = [];

    this.clientesActivos.forEach((cliente) => {
      if (
        (cliente.estado === "saliendo" || cliente.estado === "rechazado") &&
        cliente.haLlegadoAlObjetivo()
      ) {
        cliente.instanteSalida = this.tiempoSimuladoHoras;

        if (cliente.estado === "saliendo") {
          this.clientesAtendidos += 1;
          this.acumuladoSistemaHoras +=
            cliente.instanteSalida - cliente.instanteLlegada;
        }

        cliente.destruir();
        return;
      }

      restantes.push(cliente);
    });

    this.clientesActivos = restantes;
  }

  /*
   * Recalcula la geometría de la escena para mantener el flujo horizontal.
   */
  calcularLayout() {
    const rect = this.dom.scene.getBoundingClientRect();
    const width = Math.max(rect.width, 900);
    const height = Math.max(rect.height, 420);
    const centerY = height * 0.62;

    const entryX = width * 0.09;
    const waitingRoomBoxLeft = width * 0.24;
    const waitingRoomBoxTop = height * 0.24;
    const waitingRoomBoxWidth = width * 0.28;
    const waitingRoomBoxHeight = height * 0.44;
    const exitX = width * 0.92;

    this.layout.entry = { x: entryX, y: centerY };
    this.layout.exit = { x: exitX, y: centerY };

    const seatColumns = 4;
    const seatRows = 2;
    const roomPaddingX = Math.max(waitingRoomBoxWidth * 0.12, 26);
    const roomPaddingY = Math.max(waitingRoomBoxHeight * 0.18, 28);
    const innerLeft = waitingRoomBoxLeft + roomPaddingX;
    const innerRight = waitingRoomBoxLeft + waitingRoomBoxWidth - roomPaddingX;
    const innerTop = waitingRoomBoxTop + roomPaddingY;
    const innerBottom = waitingRoomBoxTop + waitingRoomBoxHeight - roomPaddingY;
    const horizontalGap =
      seatColumns > 1 ? (innerRight - innerLeft) / (seatColumns - 1) : 0;
    const verticalGap =
      seatRows > 1 ? (innerBottom - innerTop) / (seatRows - 1) : 0;

    const seats = [];
    for (let row = 0; row < seatRows; row += 1) {
      for (let column = seatColumns - 1; column >= 0; column -= 1) {
        seats.push({
          x: innerLeft + horizontalGap * column,
          y: innerTop + verticalGap * row,
        });
      }
    }

    this.layout.queueSlots = seats;

    const cantidadAsesoras = this.configuracion.operacion.cantidadAsesoras;
    const serviceStartX = width * 0.71;
    const serviceGap = cantidadAsesoras > 1 ? width * 0.14 : 0;

    this.layout.advisors = Array.from(
      { length: cantidadAsesoras },
      (_, index) => {
        const offset =
          (index - (cantidadAsesoras - 1) / 2) * serviceGap;
        const deskX = serviceStartX + offset;
        const deskY = centerY + 10;

        return {
          deskX,
          deskY,
          spriteX: deskX,
          spriteY: centerY - 64,
          clienteX: deskX - 18,
          clienteY: centerY + 6,
        };
      }
    );
  }

  construirPuestosCola() {
    this.dom.queueTrack.innerHTML = "";

    this.layout.queueSlots.forEach((slot) => {
      const node = document.createElement("div");
      node.className = "queue-slot";
      node.style.left = `${slot.x}px`;
      node.style.top = `${slot.y}px`;
      this.dom.queueTrack.appendChild(node);
    });
  }

  construirAsesoras() {
    this.asesoras.forEach((asesora) => asesora.destruir());
    this.asesoras = this.layout.advisors.map(
      (posicion, indice) => new Asesora(indice + 1, this, posicion)
    );
  }

  actualizarPosicionesTrasResize() {
    this.actualizarFondoEscena();

    this.asesoras.forEach((asesora, indice) => {
      asesora.actualizarPosicion(this.layout.advisors[indice]);
    });

    this.cola.recalcularPosiciones();

    this.clientesActivos.forEach((cliente) => {
      if (cliente.estado === "saliendo" || cliente.estado === "rechazado") {
        const offset = cliente.estado === "rechazado" ? 78 : 0;
        cliente.moverHacia(this.layout.exit.x, this.layout.exit.y + offset);
      }

      if (
        cliente.asesoraAsignada &&
        ["yendoAServicio", "enServicio"].includes(cliente.estado)
      ) {
        cliente.moverHacia(
          cliente.asesoraAsignada.posicion.clienteX,
          cliente.asesoraAsignada.posicion.clienteY
        );
      }
    });
  }

  aplicarEscenario(claveEscenario, reiniciarDespues = true) {
    this.escenarioActual = claveEscenario;
    this.configuracion = aplicarEscenario(
      this.configuracion,
      this.escenarioActual
    );

    this.actualizarBotonesEscenario();
    this.actualizarInsigniaEscenario();
    this.renderizarAnalisisAcademico();
    this.factorVelocidad = 1;
    this.sincronizarVelocidad();

    if (reiniciarDespues) {
      this.calcularLayout();
      this.construirPuestosCola();
      this.reiniciar();
    }
  }

  actualizarBotonesEscenario() {
    this.dom.scenarioButtons.forEach((button) => {
      button.classList.toggle(
        "is-active",
        button.dataset.scenario === this.escenarioActual
      );
    });
  }

  actualizarInsigniaEscenario() {
    this.dom.scenarioBadge.textContent =
      ESCENARIOS[this.escenarioActual]?.nombre || "Escenario";
  }

  actualizarEtiquetaEstado() {
    if (this.jornadaFinalizada) {
      this.dom.statusLabel.textContent = "Corrida finalizada";
      return;
    }

    if (this.jornadaLlegadasCerradas) {
      this.dom.statusLabel.textContent = "Vaciando sistema";
      return;
    }

    this.dom.statusLabel.textContent = this.enEjecucion ? "Ejecutándose" : "En espera";
  }

  actualizarFondoEscena() {
    this.dom.scene.style.backgroundImage =
      `linear-gradient(180deg, rgba(253, 251, 247, 0.82), rgba(247, 240, 229, 0.88)), url("${this.configuracion.sprites.oficina}")`;
  }

  sincronizarVelocidad() {
    const factor = Number.isFinite(this.factorVelocidad) ? this.factorVelocidad : 1;
    this.dom.speedFactor.value = String(factor);
    this.dom.speedFactorLabel.textContent = `x${factor.toFixed(2)}`;
  }

  obtenerCalculoTeoricoActual() {
    const escenario = ESCENARIOS[this.escenarioActual];

    if (!escenario) {
      return null;
    }

    const lambda = escenario.operacion.tasaLlegada;
    const mu = 1 / escenario.operacion.tiempoServicio;
    const servidores = escenario.operacion.cantidadAsesoras;

    if (servidores === 1) {
      return calcularMM1(lambda, mu);
    }

    return calcularMMC(lambda, mu, servidores);
  }

  renderizarLista(contenedor, items) {
    contenedor.innerHTML = "";

    items.forEach((texto) => {
      const item = document.createElement("li");
      item.textContent = texto;
      contenedor.appendChild(item);
    });
  }

  renderizarAnalisisAcademico() {
    const escenario = ESCENARIOS[this.escenarioActual];

    if (!escenario) {
      return;
    }

    const estudio = escenario.estudio;
    const calculo = this.obtenerCalculoTeoricoActual();

    this.dom.theoryModelBadge.textContent = `Modelo ${escenario.modelo}`;
    this.dom.theoryScenarioTitle.textContent = estudio.titulo;
    this.dom.theoryScenarioSummary.textContent = estudio.resumen;
    this.dom.theoryStability.textContent = estudio.estabilidad;
    this.dom.theoryReading.textContent = estudio.lectura;

    this.renderizarLista(this.dom.theoryIndicators, estudio.indicadores);

    if (estudio.casoCritico) {
      this.dom.criticalCaseCard.hidden = false;
      this.dom.criticalCaseTitle.textContent = estudio.casoCritico.titulo;
      this.dom.criticalCaseDetail.textContent = estudio.casoCritico.detalle;
    } else {
      this.dom.criticalCaseCard.hidden = true;
      this.dom.criticalCaseTitle.textContent = "";
      this.dom.criticalCaseDetail.textContent = "";
    }

    this.dom.comparativeSummary.textContent =
      `${ANALISIS_COMPARATIVO.resumen} ` +
      `En el escenario activo, la utilización teórica es ` +
      `${Number.isFinite(calculo?.rho) ? (calculo.rho * 100).toFixed(1) : "∞"} %.`;

    this.renderizarLista(
      this.dom.comparativeList,
      ANALISIS_COMPARATIVO.comparacion
    );
    this.renderizarLista(this.dom.proposalList, ANALISIS_COMPARATIVO.propuestas);
  }

  cerrarLlegadas() {
    if (this.jornadaLlegadasCerradas) {
      return;
    }

    this.jornadaLlegadasCerradas = true;
    this.clientesPendientesAlCierre = this.clientesActivos.filter(
      (cliente) => cliente.estado !== "rechazado"
    ).length;
    this.registrarEvento(
      `Cierre de llegadas en las 8 horas simuladas. Desde este punto solo se atienden los clientes pendientes hasta dejar el sistema vacío.`
    );
    this.actualizarEtiquetaEstado();
  }

  estaSistemaVacio() {
    return (
      this.clientesActivos.length === 0 &&
      this.cola.longitud() === 0 &&
      this.asesoras.every((asesora) => asesora.libre)
    );
  }

  obtenerResumenCorrida() {
    const escenario = ESCENARIOS[this.escenarioActual];
    const calculo = this.obtenerCalculoTeoricoActual();
    const tiempoTotalHoras = this.tiempoSimuladoHoras;
    const tiempoLlamadasHoras =
      this.configuracion.operacion.jornadaLaboralHoras || 8;
    const tiempoExtraHoras = Math.max(tiempoTotalHoras - tiempoLlamadasHoras, 0);
    const tiempoOcupadoTotal = this.asesoras.reduce(
      (acumulado, asesora) => acumulado + asesora.tiempoOcupadoAcumulado,
      0
    );
    const tiempoOciosoTotal = Math.max(
      tiempoTotalHoras * this.asesoras.length - tiempoOcupadoTotal,
      0
    );
    const promedioEsperaMin =
      this.clientesAtendidos > 0
        ? (this.acumuladoEsperaHoras / this.clientesAtendidos) * MINUTOS_POR_HORA
        : 0;
    const promedioSistemaMin =
      this.clientesAtendidos > 0
        ? (this.acumuladoSistemaHoras / this.clientesAtendidos) * MINUTOS_POR_HORA
        : 0;
    const utilizacion =
      tiempoTotalHoras > 0 && this.asesoras.length > 0
        ? (tiempoOcupadoTotal / (tiempoTotalHoras * this.asesoras.length)) * 100
        : 0;
    const longitudPromedioCola =
      tiempoTotalHoras > 0 ? this.areaLongitudCola / tiempoTotalHoras : 0;

    return {
      escenario,
      calculo,
      tiempoTotalHoras,
      tiempoLlamadasHoras,
      tiempoExtraHoras,
      tiempoOciosoTotal,
      promedioEsperaMin,
      promedioSistemaMin,
      utilizacion,
      longitudPromedioCola,
    };
  }

  renderizarModalResumen() {
    const resumen = this.obtenerResumenCorrida();
    const staffing = [
      "Temporada baja: una sola asesora es suficiente porque el sistema se mantiene estable con ρ ≈ 0,43 y baja congestión.",
      "Temporada alta: una sola persona no es suficiente; se requieren dos asesoras para estabilizar la operación y contener la espera.",
    ];
    const nota =
      `La simulación ejecutó 8 horas de llegadas y terminó en ${this.formatearTiempo(
        resumen.tiempoTotalHoras
      )} al completar el vaciado total del sistema. ` +
      `Tiempo adicional de cierre: ${this.formatearTiempo(resumen.tiempoExtraHoras)}.`;

    this.dom.summaryModalNote.textContent = nota;
    this.dom.summaryScenario.textContent = resumen.escenario?.nombre || "-";
    this.dom.summaryModel.textContent = resumen.escenario?.modelo || "-";
    this.dom.summaryTotalTime.textContent = this.formatearTiempo(resumen.tiempoTotalHoras);
    this.dom.summaryCleanupTime.textContent = this.formatearTiempo(resumen.tiempoExtraHoras);
    this.dom.summaryGenerated.textContent = String(this.clientesGenerados);
    this.dom.summaryServed.textContent = String(this.clientesAtendidos);
    this.dom.summaryRejected.textContent = String(this.clientesRechazados);
    this.dom.summaryUtilization.textContent = `${resumen.utilizacion.toFixed(2)} %`;
    this.dom.summaryAvgWait.textContent = `${resumen.promedioEsperaMin.toFixed(2)} min`;
    this.dom.summaryAvgSystem.textContent = `${resumen.promedioSistemaMin.toFixed(2)} min`;
    this.dom.summaryAvgQueue.textContent = resumen.longitudPromedioCola.toFixed(2);
    this.dom.summaryIdleTime.textContent = `${resumen.tiempoOciosoTotal.toFixed(2)} h`;

    this.dom.summaryRunInterpretation.textContent =
      `En ${resumen.escenario?.nombre || "este escenario"}, las llegadas se cerraron a las 8 horas con ` +
      `${this.clientesPendientesAlCierre} clientes pendientes por completar. ` +
      `La corrida terminó con la sala limpia y una utilización observada de ${resumen.utilizacion.toFixed(
        2
      )} %. ` +
      `Teóricamente, la utilización esperada del modelo activo es ${
        Number.isFinite(resumen.calculo?.rho)
          ? `${(resumen.calculo.rho * 100).toFixed(1)} %`
          : "infinita"
      }.`;

    this.renderizarLista(this.dom.summaryStaffingList, staffing);
    this.dom.summaryModal.hidden = false;
  }

  ocultarModalResumen() {
    if (this.dom.summaryModal) {
      this.dom.summaryModal.hidden = true;
    }
  }

  finalizarCorrida() {
    if (this.jornadaFinalizada) {
      return;
    }

    this.jornadaFinalizada = true;
    this.enEjecucion = false;

    if (this.animacionId) {
      cancelAnimationFrame(this.animacionId);
      this.animacionId = null;
    }

    this.registrarEvento(
      `Corrida finalizada con sistema vacío. Tiempo total simulado: ${this.formatearTiempo(
        this.tiempoSimuladoHoras
      )}. Clientes atendidos: ${this.clientesAtendidos}.`
    );
    this.actualizarEtiquetaEstado();
    this.renderizarMetricas();
    this.renderizarRegistro();
    this.renderizarModalResumen();
  }

  registrarEvento(mensaje) {
    this.eventos.unshift({
      tiempo: this.formatearTiempo(this.tiempoSimuladoHoras),
      mensaje,
    });

    this.eventos = this.eventos.slice(0, 8);
  }

  renderizarRegistro() {
    this.dom.eventLog.innerHTML = "";

    if (this.eventos.length === 0) {
      const item = document.createElement("li");
      item.innerHTML =
        '<span class="event-time">00:00:00</span><span class="event-message">Listo para iniciar la simulación.</span>';
      this.dom.eventLog.appendChild(item);
      return;
    }

    this.eventos.forEach((evento) => {
      const item = document.createElement("li");
      const time = document.createElement("span");
      const message = document.createElement("span");

      time.className = "event-time";
      message.className = "event-message";

      time.textContent = evento.tiempo;
      message.textContent = evento.mensaje;

      item.append(time, message);
      this.dom.eventLog.appendChild(item);
    });
  }

  renderizarMetricas() {
    const esperando = this.obtenerClientesEsperando();
    const promedioEsperaMin =
      this.clientesAtendidos > 0
        ? (this.acumuladoEsperaHoras / this.clientesAtendidos) * MINUTOS_POR_HORA
        : 0;
    const promedioSistemaMin =
      this.clientesAtendidos > 0
        ? (this.acumuladoSistemaHoras / this.clientesAtendidos) * MINUTOS_POR_HORA
        : 0;
    const utilizacion =
      this.tiempoSimuladoHoras > 0 && this.asesoras.length > 0
        ? (this.asesoras.reduce(
            (acumulado, asesora) => acumulado + asesora.tiempoOcupadoAcumulado,
            0
          ) /
            (this.tiempoSimuladoHoras * this.asesoras.length)) *
          100
        : 0;
    const longitudPromedioCola =
      this.tiempoSimuladoHoras > 0
        ? this.areaLongitudCola / this.tiempoSimuladoHoras
        : 0;

    this.dom.simulationClock.textContent = this.formatearTiempo(this.tiempoSimuladoHoras);
    this.dom.metricGenerated.textContent = String(this.clientesGenerados);
    this.dom.metricServed.textContent = String(this.clientesAtendidos);
    this.dom.metricWaiting.textContent = String(esperando);
    this.dom.metricAvgWait.textContent = `${promedioEsperaMin.toFixed(2)} min`;
    this.dom.metricAvgSystem.textContent = `${promedioSistemaMin.toFixed(2)} min`;
    this.dom.metricUtilization.textContent = `${utilizacion.toFixed(2)} %`;
    this.dom.metricAvgQueue.textContent = longitudPromedioCola.toFixed(2);
  }

  obtenerClientesEsperando() {
    return this.clientesActivos.filter((cliente) =>
      ["entrando", "yendoACola", "frenteCola", "enCola"].includes(cliente.estado)
    ).length;
  }

  formatearTiempo(horas) {
    const totalSegundos = Math.max(Math.floor(horas * SEGUNDOS_POR_HORA), 0);
    const horasEnteras = Math.floor(totalSegundos / 3600);
    const minutos = Math.floor((totalSegundos % 3600) / 60);
    const segundos = totalSegundos % 60;

    return [horasEnteras, minutos, segundos]
      .map((valor) => String(valor).padStart(2, "0"))
      .join(":");
  }
}

/*
 * Inicialización única cuando el documento ya se encuentra disponible.
 */
window.addEventListener("DOMContentLoaded", () => {
  new Simulacion();
});
