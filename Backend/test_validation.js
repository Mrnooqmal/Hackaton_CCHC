const { validateRut, validateRequired } = require('./lib/validation');

const data = {
    rut: '21993889-K',
    nombre: 'Nicolás',
    rol: 'trabajador'
};

const validation = validateRequired(data, ['rut', 'nombre', 'rol']);
console.log('Required Validation:', validation);

const rutValidation = validateRut(data.rut);
console.log('RUT Validation:', rutValidation);

const { ROLES } = require('./lib/models/Persona');
console.log('Roles Validation:', !!ROLES[data.rol]);
