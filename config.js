/*
 * Configuración central del simulador.
 * Todos los parámetros que el usuario debe poder ajustar viven aquí para evitar
 * cambios directos dentro de la lógica principal de la simulación.
 */

export const CONFIG = {
  sprites: {
    cliente: "/cliente.png",
    asesora: "/asesora.png",
    oficina: "/oficina.png",
  },

  visual: {
    // Tamaños base de los sprites en píxeles.
    tamañoCliente: 52,
    tamañoAsesora: 76,

    // Velocidad visual del desplazamiento en píxeles por segundo real.
    velocidadMovimiento: 110,

    // Escala entre tiempo real y tiempo simulado.
    // 60 significa que cada segundo real equivale a 60 segundos simulados.
    // Se reduce respecto a la versión anterior para que la diferencia entre
    // λ = 3/h y λ = 10/h sea visible sin que ambos escenarios parezcan
    // saturados por exceso de llegadas en poco tiempo real.
    escalaTiempoVisual: 60,
  },

  operacion: {
    capacidadCola: 8,
    cantidadAsesoras: 1,
    jornadaLaboralHoras: 8,

    // Tasa de llegada en clientes por hora (lambda).
    tasaLlegada: 3,

    // Tiempo medio de servicio en horas.
    // El escenario base usa 1 / 7 horas por cliente.
    tiempoServicio: 1 / 7,
  },
};

export const ESCENARIOS = {
  temporadaBaja: {
    nombre: "Temporada Baja",
    descripcion: "Demanda controlada con una sola asesora y operación estable.",
    modelo: "M/M/1",
    operacion: {
      tasaLlegada: 3,
      tiempoServicio: 1 / 7,
      cantidadAsesoras: 1,
    },
    estudio: {
      titulo: "Escenario 2: Temporada Baja",
      resumen:
        "En temporada baja, una sola asesora mantiene el sistema estable y con holgura operativa.",
      estabilidad:
        "Sistema estable porque ρ = λ/μ = 3/7 ≈ 0,429 < 1.",
      indicadores: [
        "Factor de utilización: ρ = λ/μ = 3/7 ≈ 0,429",
        "Número promedio en cola: Lq = ρ² / (1 − ρ) ≈ 0,32 clientes",
        "Número promedio en el sistema: L = ρ / (1 − ρ) ≈ 0,75 clientes",
        "Tiempo promedio de espera en cola: Wq = Lq / λ ≈ 0,107 horas ≈ 6,4 minutos",
        "Tiempo promedio en el sistema: W = L / λ = 0,25 horas = 15 minutos",
      ],
      lectura:
        "La operación funciona con baja congestión, por lo que asignar más asesoras en este escenario implicaría capacidad ociosa.",
    },
  },
  temporadaAlta: {
    nombre: "Temporada Alta",
    descripcion:
      "Mayor intensidad de llegadas; se requieren dos asesoras para estabilizar el sistema.",
    modelo: "M/M/2",
    operacion: {
      tasaLlegada: 10,
      tiempoServicio: 1 / 7,
      cantidadAsesoras: 2,
    },
    estudio: {
      titulo: "Escenario 1: Temporada Alta",
      resumen:
        "El estudio evidencia que una sola asesora no soporta la demanda pico y que la operación debe estabilizarse con dos servidoras activas.",
      casoCritico: {
        titulo: "Caso crítico con una asesora",
        detalle:
          "Si λ = 10 > μ = 7, entonces ρ = 10/7 ≈ 1,43. El sistema se vuelve inestable y la cola crece indefinidamente.",
      },
      estabilidad:
        "Con dos asesoras activas (modelo M/M/2), el sistema vuelve a ser estable con ρ ≈ 0,714.",
      indicadores: [
        "Factor de utilización: ρ = λ / (c × μ) = 10 / (2 × 7) = 10/14 ≈ 0,714",
        "Número promedio en cola: Lq ≈ 1,35 clientes",
        "Número promedio en el sistema: L = Lq + λ/μ ≈ 2,78 clientes",
        "Tiempo promedio de espera en cola: Wq = Lq / λ ≈ 0,135 horas ≈ 8,1 minutos",
        "Tiempo promedio en el sistema: W = L / λ ≈ 0,278 horas ≈ 16,7 minutos",
      ],
      lectura:
        "La incorporación temporal de una segunda asesora reduce la congestión a un nivel manejable y mejora directamente la experiencia del cliente.",
    },
  },
};

export const ANALISIS_COMPARATIVO = {
  resumen:
    "El contraste entre temporada alta y temporada baja revela una brecha operativa clara: la primera exige refuerzo temporal de capacidad, mientras la segunda funciona adecuadamente con una sola asesora.",
  comparacion: [
    "Temporada alta con una asesora: ρ ≈ 1,43, sistema inestable y cola teóricamente infinita.",
    "Temporada alta con dos asesoras: ρ ≈ 0,714 y Wq ≈ 8,1 minutos, con congestión manejable.",
    "Temporada baja con una asesora: ρ ≈ 0,429 y Wq ≈ 6,4 minutos, con operación holgada.",
  ],
  propuestas: [
    "Redistribución temporal de asesoras en temporada alta: activar dos servidoras reduce el tiempo de espera en cola desde un valor teóricamente infinito a aproximadamente 8 minutos.",
    "Implementación de agendamiento prioritario: desplazar parte de la demanda fuera de las horas pico reduce el λ efectivo y ayuda a mantener ρ por debajo de 1 en franjas de demanda moderada.",
  ],
};

/*
 * Utilidad para clonar la configuración base sin compartir referencias.
 * Esto evita que una corrida altere el estado por defecto de la siguiente.
 */
export function crearConfiguracionInicial() {
  return JSON.parse(JSON.stringify(CONFIG));
}

/*
 * Aplica los parámetros del escenario seleccionado sobre una configuración
 * existente sin tocar los ajustes visuales ya definidos.
 */
export function aplicarEscenario(configuracion, claveEscenario) {
  const escenario = ESCENARIOS[claveEscenario];

  if (!escenario) {
    return configuracion;
  }

  return {
    ...configuracion,
    operacion: {
      ...configuracion.operacion,
      ...escenario.operacion,
    },
  };
}
