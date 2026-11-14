import React from 'react';
import {createRoot}from'react-dom/client';
import{PdfTemplateWorkspace}from'../../../src/components/pdf-template-workspace';
const root=createRoot(document.getElementById('root'));
window.mountTemplate=props=>root.render(React.createElement(React.StrictMode,null,React.createElement(PdfTemplateWorkspace,{...props,onBusyChange:value=>{window.fixture.busy=value;},onAccessDenied:value=>{window.fixture.denied=value;},onGenerated:value=>{window.fixture.generated=value;}})));
window.mountTemplate(window.fixture.props);
