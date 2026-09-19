// coprocesador.js - Co-procesador Matemático FPU de 16 Bits / Punto flotante
class MathCoprocessor16 {
    constructor(cpu) {
        this.cpu = cpu;
        
        // Registros de 16 bits / FP
        this.registers = {
            fpr0: 0.0,
            fpr1: 0.0,
            fpr2: 0.0,
            fpr3: 0.0
        };

        // Almacenamiento temporal del valor entero sin escalar de 16 bits
        this.rawRegisters = {
            raw0: 0,
            raw1: 0
        };

        // Registro de Estado (Status Register)
        this.status = {
            busy: false,
            zero: false,
            overflow: false,
            underflow: false,
            invalid: false
        };

        // Estado actual de los buses físicos simulados
        this.bus = {
            addressBus: 0x0000,
            dataBus: 0x00,
            controlSignal: 'IDLE', // 'READ', 'WRITE', 'IO_IN', 'IO_OUT', 'COP_EXEC'
            activeSource: 'NONE',  // 'CPU', 'RAM', 'COPROCESSOR'
            activeTarget: 'NONE'
        };

        // Dirección de Memoria Compartida en RAM para intercambio masivo de datos (Shared Memory)
        this.sharedMemoryBase = 0x3000; // 3000H a 3007H
    }

    reset() {
        this.registers.fpr0 = 0.0;
        this.registers.fpr1 = 0.0;
        this.registers.fpr2 = 0.0;
        this.registers.fpr3 = 0.0;
        this.rawRegisters.raw0 = 0;
        this.rawRegisters.raw1 = 0;
        this.status = { busy: false, zero: false, overflow: false, underflow: false, invalid: false };
        this.bus = { addressBus: 0x0000, dataBus: 0x00, controlSignal: 'IDLE', activeSource: 'NONE', activeTarget: 'NONE' };
        this.updateUI();
    }

    // Conversión a entero con signo de 16 bits (Sin escala)
    _16BitToSignedInt(uint16Val) {
        return uint16Val > 32767 ? uint16Val - 65536 : uint16Val;
    }

    // Conversión a flotante (Con escala x100)
    _16BitToFloat(uint16Val) {
        let signed = this._16BitToSignedInt(uint16Val);
        return parseFloat((signed / 100.0).toFixed(2));
    }

    // Escribir datos compartidos a RAM (Intercambio entre CPU y Coprocesador)
    writeSharedMemory(offset, value16) {
        const addr = this.sharedMemoryBase + offset;
        const low = value16 & 0xFF;
        const high = (value16 >> 8) & 0xFF;

        this.cpu.writeMemory(addr, low);
        this.cpu.writeMemory(addr + 1, high);

        this.triggerBusTrace(addr, low, 'WRITE', 'COPROCESSOR', 'RAM');
    }

    // Lectura de 16 bits en formato Little-Endian
    readSharedMemory(baseAddr) {
        if (!this.cpu || !this.cpu.memory) return 0;
        const low = this.cpu.readMemory(baseAddr);
        const high = this.cpu.readMemory(baseAddr + 1);
        return (high << 8) | low;
    }

    // Procesamiento de comandos I/O enviadas con OUT
    handleOut(port, val) {
        this.triggerBusTrace(port, val, 'IO_OUT', 'CPU', 'COPROCESSOR');

        if (port === 0xF0) { 
            // Puerto de comandos: Aquí se ejecuta la operación
            this.executeFPOperation(val);
        } else if (port === 0xF2) { 
            // Cargar Operando 1 desde RAM
            this.rawRegisters.raw0 = this.readSharedMemory(0x3000);
            this.registers.fpr0 = this._16BitToSignedInt(this.rawRegisters.raw0);
            this.updateUI();
        } else if (port === 0xF3) { 
            // Cargar Operando 2 desde RAM
            this.rawRegisters.raw1 = this.readSharedMemory(0x3002);
            this.registers.fpr1 = this._16BitToSignedInt(this.rawRegisters.raw1);
            this.updateUI();
        }
    }

    // Lectura de puertos I/O con IN
    handleIn(port) {
        let result = 0;
        if (port === 0xF1) { // Puerto de Estado FPU
            result = (this.status.busy ? 0x80 : 0x00) |
                     (this.status.zero ? 0x01 : 0x00) |
                     (this.status.overflow ? 0x02 : 0x00) |
                     (this.status.invalid ? 0x04 : 0x00);
        }
        this.triggerBusTrace(port, result, 'IO_IN', 'COPROCESSOR', 'CPU');
        return result;
    }

    // Ejecución de Operaciones Matemáticas (Enteras y Flotantes)
    executeFPOperation(command) {
        this.status.busy = true;
        this.status.invalid = false;

        switch (command) {
            // COMANDOS DE ENTEROS PUROS (01H - 04H)
            case 0x01: // SUMA ENTERA
                this.registers.fpr0 = this._16BitToSignedInt(this.rawRegisters.raw0);
                this.registers.fpr1 = this._16BitToSignedInt(this.rawRegisters.raw1);
                this.registers.fpr2 = this.registers.fpr0 + this.registers.fpr1;
                break;

            case 0x02: // MULTIPLICACIÓN ENTERA
                this.registers.fpr0 = this._16BitToSignedInt(this.rawRegisters.raw0);
                this.registers.fpr1 = this._16BitToSignedInt(this.rawRegisters.raw1);
                this.registers.fpr2 = this.registers.fpr0 * this.registers.fpr1;
                break;

            case 0x03: // RESTA ENTERA
                this.registers.fpr0 = this._16BitToSignedInt(this.rawRegisters.raw0);
                this.registers.fpr1 = this._16BitToSignedInt(this.rawRegisters.raw1);
                this.registers.fpr2 = this.registers.fpr0 - this.registers.fpr1;
                break;

            case 0x04: // DIVISIÓN ENTERA
                this.registers.fpr0 = this._16BitToSignedInt(this.rawRegisters.raw0);
                this.registers.fpr1 = this._16BitToSignedInt(this.rawRegisters.raw1);
                if (this.registers.fpr1 !== 0) {
                    this.registers.fpr2 = Math.floor(this.registers.fpr0 / this.registers.fpr1);
                } else {
                    this.status.invalid = true;
                }
                break;

            // COMANDOS DE PUNTO FLOTANTE / FIJO CON ESCALA x100 (11H - 14H)
            case 0x11: // SUMA FLOTANTE
                this.registers.fpr0 = this._16BitToFloat(this.rawRegisters.raw0);
                this.registers.fpr1 = this._16BitToFloat(this.rawRegisters.raw1);
                this.registers.fpr2 = parseFloat((this.registers.fpr0 + this.registers.fpr1).toFixed(2));
                break;

            case 0x12: // MULTIPLICACIÓN FLOTANTE
                this.registers.fpr0 = this._16BitToFloat(this.rawRegisters.raw0);
                this.registers.fpr1 = this._16BitToFloat(this.rawRegisters.raw1);
                this.registers.fpr2 = parseFloat((this.registers.fpr0 * this.registers.fpr1).toFixed(2));
                break;

            case 0x13: // RESTA FLOTANTE
                this.registers.fpr0 = this._16BitToFloat(this.rawRegisters.raw0);
                this.registers.fpr1 = this._16BitToFloat(this.rawRegisters.raw1);
                this.registers.fpr2 = parseFloat((this.registers.fpr0 - this.registers.fpr1).toFixed(2));
                break;

            case 0x14: // DIVISIÓN FLOTANTE
                this.registers.fpr0 = this._16BitToFloat(this.rawRegisters.raw0);
                this.registers.fpr1 = this._16BitToFloat(this.rawRegisters.raw1);
                if (this.registers.fpr1 !== 0) {
                    this.registers.fpr2 = parseFloat((this.registers.fpr0 / this.registers.fpr1).toFixed(2));
                } else {
                    this.status.invalid = true;
                }
                break;

            default:
                this.status.invalid = true;
                break;
        }

        // Banderas FPU
        this.status.zero = (this.registers.fpr2 === 0);
        this.status.busy = false;

        // Formateo y persistencia en RAM (Dirección 3004H)
        let resultRaw = 0;
        if (command >= 0x11 && command <= 0x14) {
            resultRaw = Math.round(this.registers.fpr2 * 100) & 0xFFFF;
        } else {
            resultRaw = Math.round(this.registers.fpr2) & 0xFFFF;
        }

        this.registers.fpr3 = resultRaw; // Copia cruda a FPR3 (Temp)
        this.writeSharedMemory(4, resultRaw);
        this.updateUI();
    }

    // Actualizador visual compatible con la interfaz HTML
    updateUI() {
        const setTxt = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setTxt('fpr0-val', this.registers.fpr0);
        setTxt('fpr1-val', this.registers.fpr1);
        setTxt('fpr2-val', this.registers.fpr2);
        setTxt('fpr3-val', this.registers.fpr3);

        setTxt('fpu-busy', this.status.busy ? '1' : '0');
        setTxt('fpu-zero', this.status.zero ? '1' : '0');
        setTxt('fpu-err', this.status.invalid ? '1' : '0');
    }

    triggerBusTrace(address, data, control, source, target) {
        this.bus.addressBus = address;
        this.bus.dataBus = data;
        this.bus.controlSignal = control;
        this.bus.activeSource = source;
        this.bus.activeTarget = target;
    }
}

if (typeof module !== 'undefined') {
    module.exports = MathCoprocessor16;
}