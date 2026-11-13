import React from 'react';
import{createRoot}from'react-dom/client';
import{UploadedPdfSigning}from'../../../src/components/uploaded-pdf-signing';
import{UploadedPdfGuest}from'../../../src/components/uploaded-pdf-guest';
const fixture=window.fixture;
createRoot(document.getElementById('root')).render(fixture.mode==='guest'?React.createElement(UploadedPdfGuest,{initialSource:fixture.source}):React.createElement(UploadedPdfSigning,{...fixture.props,onBusyChange:busy=>{fixture.busy=busy;}}));
